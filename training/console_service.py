"""Local-only experiment controller. No shell commands or user-supplied filesystem paths."""
from __future__ import annotations

import argparse
import atexit
import os
from datetime import datetime, timezone
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
import hashlib
from experiment_io import write_json

ROOT = Path(__file__).resolve().parent
RUN_ID = re.compile(r'^[a-zA-Z0-9_-]{1,80}$')
DEFAULTS = {'steps': 2048, 'generations': 1, 'seed': 1701, 'max_ticks': 2000,'protocol':'hunter-phase1','hunter_speed_ratio':1.35}


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def validate_config(config):
    if not isinstance(config, dict) or set(config) - set(DEFAULTS):
        raise ValueError('配置包含未知字段')
    result = DEFAULTS | config
    if result['protocol'] not in ('hunter-phase1','selfplay','hunter-pursuit-v2'):raise ValueError('protocol 无效')
    if type(result['hunter_speed_ratio']) not in (int,float) or not .5<=result['hunter_speed_ratio']<=3:raise ValueError('猎人速度倍率必须在 0.5–3 内')
    for key, low, high in [('steps', 2, 10_000_000), ('generations', 1, 100), ('seed', 0, 2**31-1), ('max_ticks', 10, 36000)]:
        value = result[key]
        if type(value) is not int or not low <= value <= high:
            raise ValueError(f'{key} 必须在 {low}–{high} 内')
    return result


class RunManager:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.process = None
        self.active_id = None
        self.active_kind = None
        # A controller restart cannot inherit child handles; never pretend a stale task is running.
        for folder in self.root.iterdir():
            if folder.is_dir() and RUN_ID.fullmatch(folder.name):
                state = read_json(folder / 'task.json', {})
                if state.get('status') in ('running', 'stopping'):
                    state.update(status='interrupted', message='控制台上次异常退出；确认旧进程已结束后，从完整代恢复')
                    write_json(folder / 'task.json', state)

    def folder(self, run_id):
        if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
            raise ValueError('实验编号无效')
        folder = self.root / run_id
        if folder.is_symlink() or not folder.is_dir() or folder.resolve().parent != self.root:
            raise ValueError('实验不存在')
        return folder

    def create(self, config):
        if not isinstance(config, dict):
            raise ValueError('配置必须是对象')
        config = dict(config)
        name = self.validate_name(config.pop('name', ''))
        config = validate_config(config)
        with self.lock:
            run_id = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-') + secrets.token_hex(3)
            folder = self.root / run_id
            folder.mkdir()
            write_json(folder / 'config.json', config)
            write_json(folder / 'task.json', {'id': run_id, 'name': name or run_id, 'status': 'created', 'kind': 'training', 'created': time.time()})
            return self.detail(run_id)

    @staticmethod
    def validate_name(name):
        if not isinstance(name, str) or len(name.strip()) > 80 or any(ord(c) < 32 for c in name):
            raise ValueError('任务名称最多 80 个字符，不允许换行或控制字符')
        return name.strip()

    def rename(self, run_id, name):
        name = self.validate_name(name)
        if not name:
            raise ValueError('任务名称不能为空')
        with self.lock:
            folder = self.folder(run_id)
            state = read_json(folder / 'task.json', {})
            state['name'] = name
            write_json(folder / 'task.json', state)
            return self.detail(run_id)

    def configure(self, run_id, changes):
        with self.lock:
            folder = self.folder(run_id)
            state = read_json(folder / 'task.json', {})
            if state.get('archived'):
                raise ValueError('请先恢复任务')
            if not isinstance(changes, dict):
                raise ValueError('配置必须是对象')
            saved = read_json(folder / 'config.json', {})
            config = validate_config({'protocol': 'selfplay', **saved, **changes})
            pristine = state.get('status') == 'created' and not state.get('started') and not any((folder / item).exists() for item in ('metrics.json', 'source-manifest.json', 'process.log', 'checkpoints'))
            if pristine:
                write_json(folder / 'config.json', config)
                return self.detail(run_id)
            child = self.create({**config, 'name': (state.get('name', run_id)[:72] + ' · 新配置')})
            child_folder = self.folder(child['id'])
            child_state = read_json(child_folder / 'task.json', {})
            child_state['parentId'] = run_id
            write_json(child_folder / 'task.json', child_state)
            return self.detail(child['id'])

    def archive(self, run_id):
        with self.lock:
            folder = self.folder(run_id)
            state = read_json(folder / 'task.json', {})
            if state.get('status') in ('running', 'stopping') or (self.active_id == run_id and self.process is not None and self.process.poll() is None):
                raise ValueError('请先停止运行中的任务，再移入回收站')
            state.update(archived=True, archivedAt=time.time())
            write_json(folder / 'task.json', state)
            return self.detail(run_id)

    def restore(self, run_id):
        with self.lock:
            folder = self.folder(run_id)
            state = read_json(folder / 'task.json', {})
            state['archived'] = False
            state.pop('archivedAt', None)
            write_json(folder / 'task.json', state)
            return self.detail(run_id)

    def detail(self, run_id):
        folder = self.folder(run_id)
        state = read_json(folder / 'task.json', {})
        state.setdefault('name', run_id)
        latest = read_json(folder / 'latest-evaluation.json')
        evaluation = read_json(folder / 'evaluations' / latest['id'] / 'result.json') if latest else read_json(folder / 'evaluation.json')
        state.update(id=run_id, config=read_json(folder / 'config.json'),
                     codeSnapshot=read_json(folder/'source-manifest.json'),
                     live=read_json(folder / 'live.json'), metrics=read_json(folder / 'metrics.json'),
                     evaluation=evaluation, evaluationContext=latest,
                     resumable=bool(read_json(folder / 'metrics.json', {}).get('generations')))
        logfile = folder / 'process.log'
        if logfile.exists():
            with logfile.open('rb') as stream:
                stream.seek(max(0, logfile.stat().st_size - 20000))
                state['log'] = stream.read().decode('utf-8', errors='replace')
        else:
            state['log'] = ''
        history = folder / 'history.jsonl'
        if history.exists():
            with history.open('rb') as stream:
                stream.seek(max(0, history.stat().st_size - 200000))
                lines = stream.read().decode('utf-8', errors='replace').splitlines()[-400:]
            state['history'] = []
            state['historyTotal']=sum(1 for _ in history.open('r',encoding='utf-8'))
            state['historyTruncated']=state['historyTotal']>len(lines)
            for line in lines:
                try:
                    state['history'].append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        else:
            state['history'] = []
        return state

    def snapshot_source(self,folder):
        destination=folder/'source'/'apps'/'hunter-arena';training=destination/'training'
        if (folder/'source-manifest.json').exists():return training
        training.mkdir(parents=True,exist_ok=True)
        files=[p for p in (ROOT.parent/'src').rglob('*.ts') if not p.name.endswith('.test.ts')]+[p for p in ROOT.glob('*.ts') if not p.name.endswith('.test.ts')]+list(ROOT.glob('*.py'))+list((ROOT/'hunter_arena_env').glob('*.py'))+list((ROOT.parent/'public'/'maps'/'phase1').glob('*.json'))+[ROOT.parent/'package.json',ROOT.parent/'package-lock.json']
        hashes={}
        for source in files:
            relative=source.relative_to(ROOT.parent);target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
            hashes[str(relative).replace('\\','/')]=hashlib.sha256(target.read_bytes()).hexdigest()
        code_hash=hashlib.sha256(json.dumps(hashes,sort_keys=True).encode()).hexdigest()
        write_json(folder/'source-manifest.json',{'codeHash':code_hash,'files':hashes,'created':time.time()})
        return training

    def list_runs(self, archived=False):
        return [self.detail(folder.name) for folder in sorted(self.root.iterdir(), reverse=True)
                if folder.is_dir() and RUN_ID.fullmatch(folder.name) and (folder / 'task.json').exists()
                and bool(read_json(folder / 'task.json', {}).get('archived')) == archived]

    def _launch(self, run_id, kind, args):
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                raise ValueError('已有任务运行；请先停止或等待完成')
            folder = self.folder(run_id)
            if read_json(folder / 'task.json', {}).get('archived'):
                raise ValueError('请先从回收站恢复任务')
            runtime=self.snapshot_source(folder)
            (folder / 'stop.request').unlink(missing_ok=True)
            log = (folder / 'process.log').open('ab')
            try:
                child_env=os.environ.copy();child_env['NODE_PATH']=str(ROOT.parent/'node_modules')+os.pathsep+child_env.get('NODE_PATH','')
                child_env['PYTHONPATH']=str(runtime)
                child_env['HUNTER_CODE_HASH']=read_json(folder/'source-manifest.json')['codeHash']
                self.process = subprocess.Popen([sys.executable, '-u', *args], cwd=runtime, stdout=log,
                                                stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,env=child_env)
            finally:
                log.close()
            self.active_id, self.active_kind = run_id, kind
            process = self.process
            state = read_json(folder / 'task.json', {})
            state.update(status='running', kind=kind, started=time.time(), pid=process.pid, message='')
            write_json(folder / 'task.json', state)
            threading.Thread(target=self._watch, args=(run_id, process), daemon=True).start()
            return self.detail(run_id)

    def _watch(self, run_id, process):
        code = process.wait()
        with self.lock:
            folder = self.folder(run_id)
            state = read_json(folder / 'task.json', {})
            if state.get('pid') != process.pid:
                return
            stopped = state.get('status') == 'stopping'
            state.update(status='stopped' if stopped else 'completed' if code == 0 else 'failed',
                         exitCode=code, ended=time.time())
            write_json(folder / 'task.json', state)

    def start(self, run_id, resume=False):
        with self.lock:
            return self._start_locked(run_id, resume)

    def _start_locked(self, run_id, resume=False):
        folder = self.folder(run_id)
        if read_json(folder / 'task.json', {}).get('archived'):
            raise ValueError('请先从回收站恢复任务')
        saved=read_json(folder / 'config.json');config = validate_config({'protocol':'selfplay',**saved})
        if resume and not read_json(folder / 'metrics.json', {}).get('generations'):
            raise ValueError('没有完整代检查点，不能恢复；请创建新实验')
        if not resume and (folder / 'metrics.json').exists():
            raise ValueError('已有训练数据；请使用恢复训练')
        args = ['train.py', '--output', str(folder), '--run-id', run_id]
        for key, value in config.items():
            args += ['--' + key.replace('_', '-'), str(value)]
        if resume:
            args.append('--resume')
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                raise ValueError('已有任务运行；请先停止或等待完成')
            evaluation = folder / 'evaluation.json'
            if evaluation.exists():
                evaluation.rename(folder / f'evaluation-before-training-{time.time_ns()}.json')
            (folder / 'latest-evaluation.json').unlink(missing_ok=True)
            return self._launch(run_id, 'training', args)

    def terminate_owned_tree(self):
        if self.process is None or self.process.poll() is not None:
            return
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(self.process.pid), '/T', '/F'], capture_output=True, timeout=10)
        else:
            self.process.terminate()

    def stop(self, run_id):
        with self.lock:
            if self.active_id != run_id or self.process is None or self.process.poll() is not None:
                raise ValueError('该实验没有运行中的任务')
            folder = self.folder(run_id)
            state = read_json(folder / 'task.json')
            state['status'] = 'stopping'
            state['message'] = '训练将在下一步保存停止快照；续训仍从完整代恢复' if self.active_kind == 'training' else '正在结束评估'
            write_json(folder / 'task.json', state)
            if self.active_kind == 'training':
                (folder / 'stop.request').write_text('stop', encoding='utf-8')
            else:
                self.terminate_owned_tree()
            return self.detail(run_id)

    def evaluate(self, run_id, seeds=20, *, side='pair', opponent_id=None):
        if type(seeds) is not int or not 1 <= seeds <= 1000:
            raise ValueError('测试种子数量必须在 1–1000 内')
        if side not in ('pair', 'runner', 'hunter'):
            raise ValueError('测试角色必须是 pair/runner/hunter')
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                raise ValueError('已有任务运行；请先停止或等待完成')
            folder = self.folder(run_id)
            config=read_json(folder/'config.json')
            if config.get('protocol','selfplay') in ('hunter-phase1','hunter-pursuit-v2'):
                if side not in ('pair','hunter') or opponent_id:raise ValueError('阶段一使用固定随机逃亡者，无需选择对手实验')
                if not (folder/'hunter-policy.json').exists():raise ValueError('尚未生成猎人模型')
                evaluation_id='eval-'+str(time.time_ns())+'-'+secrets.token_hex(2);destination=folder/'evaluations'/evaluation_id;destination.mkdir(parents=True)
                shutil.copyfile(folder/'hunter-policy.json',destination/'hunter-policy.json')
                context={'id':evaluation_id,'targetSide':'hunter','runnerRunId':'smart-escape-v1' if config['protocol']=='hunter-pursuit-v2' else 'frozen-waypoint-v1','hunterRunId':run_id,'seeds':list(range(1,seeds+1)),'protocol':config['protocol'],'hunterSpeedRatio':config['hunter_speed_ratio']}
                write_json(destination/'config.json',context)
                self._launch(run_id,'evaluation',['evaluate.py','--protocol',config['protocol'],'--hunter-speed-ratio',str(config['hunter_speed_ratio']),'--hunter-policy',str(destination/'hunter-policy.json'),'--max-ticks',str(config['max_ticks']),'--output',str(destination/'result.json'),'--verify-determinism','--seeds',*map(str,range(1,seeds+1))])
                write_json(folder/'latest-evaluation.json',context);return self.detail(run_id)
            opponent = self.folder(opponent_id) if side != 'pair' else folder
            runner_source = folder if side in ('pair', 'runner') else opponent
            hunter_source = folder if side in ('pair', 'hunter') else opponent
            if not (runner_source / 'runner-policy.json').exists() or not (hunter_source / 'hunter-policy.json').exists():
                raise ValueError('候选或冻结对手尚未生成模型')
            evaluation_id = 'eval-' + str(time.time_ns()) + '-' + secrets.token_hex(2)
            destination = folder / 'evaluations' / evaluation_id
            destination.mkdir(parents=True)
            for role, source in [('runner',runner_source),('hunter',hunter_source)]:
                shutil.copyfile(source / f'{role}-policy.json', destination / f'{role}-policy.json')
            context = {'id':evaluation_id,'targetSide':side,'opponentId':opponent_id if side != 'pair' else run_id,
                       'runnerRunId':runner_source.name,'hunterRunId':hunter_source.name,'seeds':list(range(1,seeds+1))}
            write_json(destination / 'config.json', context)
            result = self._launch(run_id, 'evaluation', ['evaluate.py', '--runner-policy', str(destination / 'runner-policy.json'),
                                '--hunter-policy', str(destination / 'hunter-policy.json'), '--max-ticks', str(read_json(folder / 'config.json')['max_ticks']),
                                '--output', str(destination / 'result.json'), '--verify-determinism', '--seeds', *map(str, range(1, seeds+1))])
            write_json(folder / 'latest-evaluation.json', context)
            return self.detail(run_id)

    def compare(self, run_ids):
        if not isinstance(run_ids, list) or not 1 <= len(run_ids) <= 8:
            raise ValueError('请选择 1–8 个实验')
        rows = []
        for run_id in run_ids:
            detail = self.detail(run_id)
            rows.append({'id':run_id,'config':detail['config'],'evaluation':detail['evaluation'],
                         'evaluationContext':detail.get('evaluationContext') or {'targetSide':'pair','runnerRunId':run_id,'hunterRunId':run_id}})
        signature = lambda row: (row['evaluation'].get('maxTicks'), row['evaluation'].get('seeds'),row['evaluation'].get('trainingProtocol','selfplay'),row['evaluation'].get('hunterSpeedRatio',1),row['evaluation'].get('rewardVersion'),row['evaluation'].get('mapPool'),row['evaluation'].get('spawnPolicy'),row['evaluation'].get('codeHash')) if row['evaluation'] else None
        same_scenario = all(signature(row) is not None and signature(row) == signature(rows[0]) and row['evaluation'].get('codeHash') not in (None,'direct-script-no-snapshot') for row in rows)
        hunter_hashes = {row['evaluation'].get('hunterModelSha256') for row in rows if row['evaluation']}
        runner_hashes = {row['evaluation'].get('runnerModelSha256') for row in rows if row['evaluation']}
        runner_owned = all(row['evaluationContext']['targetSide'] in ('pair','runner') and row['evaluationContext']['runnerRunId']==row['id'] for row in rows)
        hunter_owned = all(row['evaluationContext']['targetSide'] in ('pair','hunter') and row['evaluationContext']['hunterRunId']==row['id'] for row in rows)
        runner_comparable = same_scenario and runner_owned and len(hunter_hashes) == 1 and None not in hunter_hashes
        hunter_comparable = same_scenario and hunter_owned and len(runner_hashes) == 1 and None not in runner_hashes
        for row in rows:
            row.update(comparable=runner_comparable and hunter_comparable, sameScenario=same_scenario,
                       runnerComparable=runner_comparable, hunterComparable=hunter_comparable)
        return rows

    def close(self):
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                if self.active_kind == 'training':
                    (self.folder(self.active_id) / 'stop.request').write_text('stop', encoding='utf-8')
                else:
                    self.terminate_owned_tree()
                try:
                    self.process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    self.terminate_owned_tree()
                    self.process.wait(timeout=10)


def make_handler(manager, token, port):
    allowed_hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
    allowed_origins = {f'http://{host}' for host in allowed_hosts}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, value, status=200, content_type='application/json; charset=utf-8'):
            body = value.encode('utf-8') if isinstance(value, str) else json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(body)

        def permitted(self):
            return self.headers.get('Host') in allowed_hosts and self.headers.get('Origin', next(iter(allowed_origins))) in allowed_origins

        def do_GET(self):
            if not self.permitted():
                return self.send({'error': '仅允许本机同源访问'}, 403)
            try:
                if self.path == '/':
                    return self.send((ROOT / 'console.html').read_text(encoding='utf-8').replace('__TOKEN__', token), content_type='text/html; charset=utf-8')
                if self.path == '/api/runs':
                    return self.send(manager.list_runs())
                if self.path == '/api/archived':
                    return self.send(manager.list_runs(archived=True))
                if self.path.startswith('/api/runs/'):
                    if self.path.endswith('/history'):
                        folder=manager.folder(self.path.removeprefix('/api/runs/').removesuffix('/history'))
                        return self.send((folder/'history.jsonl').read_text(encoding='utf-8') if (folder/'history.jsonl').exists() else '',content_type='application/x-ndjson; charset=utf-8')
                    return self.send(manager.detail(self.path.removeprefix('/api/runs/')))
                self.send({'error': '不存在'}, 404)
            except ValueError as error:
                self.send({'error': str(error)}, 400)

        def do_POST(self):
            if not self.permitted() or not hmac.compare_digest(self.headers.get('X-Console-Token', ''), token):
                return self.send({'error': '请求来源或令牌无效'}, 403)
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 16384:
                    raise ValueError('请求大小无效')
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError('请求必须是 JSON 对象')
                if self.path == '/api/runs':
                    return self.send(manager.create(data), 201)
                if self.path == '/api/compare':
                    return self.send(manager.compare(data.get('ids')))
                match = re.fullmatch(r'/api/runs/([\w-]+)/(start|resume|stop|evaluate|rename|archive|restore|configure)', self.path)
                if not match:
                    return self.send({'error': '不存在'}, 404)
                run_id, action = match.groups()
                if action == 'configure':
                    return self.send(manager.configure(run_id, data))
                if action in ('rename', 'archive', 'restore'):
                    return self.send(manager.rename(run_id, data.get('name')) if action == 'rename' else manager.archive(run_id) if action == 'archive' else manager.restore(run_id))
                result = manager.start(run_id, resume=action == 'resume') if action in ('start', 'resume') else manager.stop(run_id) if action == 'stop' else manager.evaluate(run_id, data.get('seeds', 20), side=data.get('side','pair'), opponent_id=data.get('opponentId'))
                self.send(result)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
                self.send({'error': str(error)}, 400)
            except OSError as error:
                self.send({'error': f'任务启动失败：{error}'}, 500)
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--runs', type=Path, default=ROOT.parents[2] / 'training-runs')
    parser.add_argument('--open', action='store_true')
    args = parser.parse_args()
    manager = RunManager(args.runs)
    atexit.register(manager.close)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(manager, secrets.token_hex(24), args.port))
    print(f'训练工作台 http://127.0.0.1:{args.port}/\n实验目录 {manager.root}\n请在终端按 Ctrl+C 正常退出并停止任务；直接关闭窗口可能导致中断。', flush=True)
    if args.open:
        webbrowser.open(f'http://127.0.0.1:{args.port}/')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        manager.close()


if __name__ == '__main__':
    main()

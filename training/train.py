"""Alternating frozen-opponent Maskable PPO; each --resume adds generations."""
import argparse
import json
from pathlib import Path
import random
import shutil
import time
import re

import numpy as np
import torch
from sb3_contrib import MaskablePPO
from stable_baselines3.common.callbacks import BaseCallback
from hunter_arena_env.env import HunterArenaEnv
from hunter_arena_env.export import export_policy, verify_export
from experiment_io import write_json
from phase1_metrics import summary as phase1_summary
import hashlib
import os


class MetricsCallback(BaseCallback):
    def __init__(self, output=None, generation=1, side='runner', steps=2048, protocol='selfplay', hunter_speed_ratio=1.35):
        super().__init__()
        self.rewards, self.episodes, self.observations = [], [], []
        self.output = Path(output) if output else None
        self.generation, self.side, self.steps = generation, side, steps
        self.started = time.monotonic()
        self.stopped = False
        self.reward_terms = {}
        self.protocol,self.hunter_speed_ratio=protocol,hunter_speed_ratio

    def publish(self):
        if not self.output:
            return
        elapsed = max(.001, time.monotonic() - self.started)
        diagnostics = {key: float(value) for key, value in self.model.logger.name_to_value.items()
                       if key.startswith('train/') and isinstance(value, (int, float, np.number)) and np.isfinite(value)}
        samples = [runner for episode in self.episodes for runner in episode.get('runners', [])]
        row = {'generation': self.generation, 'side': self.side, 'phaseSteps': self.n_calls,
               'requestedSteps': self.steps, 'totalSteps': self.num_timesteps, 'elapsedSeconds': elapsed,
               'fps': self.n_calls / elapsed, 'meanReward': float(np.mean(self.rewards[-512:])) if self.rewards else 0,
               'episodes': len(self.episodes), 'diagnostics': diagnostics,
               'meanSurvivalSeconds': float(np.mean([r['survivalSeconds'] for r in samples])) if samples else None,
               'skillUseRate': float(np.mean([r['skillUsed'] for r in samples])) if samples else None,
               'rewardBreakdown': {key: total / max(1,self.n_calls) for key,total in self.reward_terms.items()},
               'time': time.time(), 'stopped': self.stopped}
        if self.protocol in ('hunter-phase1','hunter-pursuit-v2'):
            row.update(trainingProtocol='hunter-pursuit-v2' if self.protocol=='hunter-pursuit-v2' else 'hunter-capture7-v1',hunterSpeedRatio=self.hunter_speed_ratio,phase1Summary=phase1_summary(self.episodes))
        write_json(self.output / 'live.json', row)
        with (self.output / 'history.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(row, allow_nan=False) + '\n')

    def _on_rollout_end(self):
        self.publish()

    def _on_step(self):
        self.rewards.extend(float(value) for value in self.locals['rewards'])
        if len(self.observations) < 100:
            self.observations.extend(self.locals['new_obs'].copy())
        for info in self.locals['infos']:
            for key,value in info.get('reward_breakdown', {}).items():
                if isinstance(value,(int,float)) and np.isfinite(value):
                    self.reward_terms[key] = self.reward_terms.get(key,0) + float(value)
            if 'episode_stats' in info:
                self.episodes.append(info['episode_stats'])
        if self.output and (self.output / 'stop.request').exists():
            self.stopped = True
            self.model.save(self.output / f'interrupted-{self.side}.zip')
            self.publish()
            return False
        if self.n_calls % 128 == 0:
            self.publish()
        return True


def train(output, generations=1, steps=250_000, seed=1701, resume=False, max_ticks=2000, run_id=None, protocol='selfplay', hunter_speed_ratio=1.35):
    if protocol not in ('selfplay','hunter-phase1','hunter-pursuit-v2') or not .5<=hunter_speed_ratio<=3:
        raise ValueError('invalid training protocol/speed')
    effective_speed=hunter_speed_ratio if protocol in ('hunter-phase1','hunter-pursuit-v2') else 1
    gamma=.999 if protocol in ('hunter-phase1','hunter-pursuit-v2') else .99
    if generations < 1 or steps < 2:
        raise ValueError('generations must be positive and steps must be at least 2')
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    run_id = run_id or output.name
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', run_id):
        raise ValueError('run-id must be 1–80 ASCII letters, numbers, underscores or hyphens')
    metrics_path = output / 'metrics.json'
    if resume and not metrics_path.exists():
        raise ValueError('--resume requires existing metrics and generation checkpoints')
    if not resume and metrics_path.exists():
        raise ValueError('output already contains training; use --resume or a new output')
    metrics = json.loads(metrics_path.read_text(encoding='utf-8')) if resume else {
        'schemaVersion': 1, 'algorithm': 'MaskablePPO', 'observationSchemaVersion': 1,
        'actionSchemaVersion': 1, 'seed': seed, 'maxTicks': max_ticks,
        'status': 'smoke-or-training-only', 'evaluated': False, 'generations': []}
    if resume and metrics.get('runId', run_id) != run_id:
        raise ValueError('resume run-id must match the saved run')
    metrics['runId'] = run_id
    if resume and (metrics.get('protocol','selfplay')!=protocol or metrics.get('hunterSpeedRatio',effective_speed)!=effective_speed):
        raise ValueError('resume protocol/speed must match saved run; create a new experiment')
    if resume and metrics.get('gamma',.99)!=gamma:raise ValueError('resume discount gamma must match saved run')
    metrics.update(protocol=protocol,hunterSpeedRatio=effective_speed,gamma=gamma,observationSchemaVersion=2 if protocol=='hunter-pursuit-v2' else 1,network={'algorithm':'MaskablePPO','hiddenLayers':[64,64],'activation':'tanh','hunterObservationSize':325 if protocol=='hunter-pursuit-v2' else 313,'actions':18})
    metrics['codeHash']=os.environ.get('HUNTER_CODE_HASH','direct-script-no-snapshot')
    if protocol in ('hunter-phase1','hunter-pursuit-v2'):
        maps=Path(__file__).parent.parent/'public'/'maps'/'phase1'
        manifest=[{'id':f'{i:02d}','sha256':hashlib.sha256((maps/f'{i:02d}.json').read_bytes()).hexdigest()} for i in range(1,11)]
        if resume and metrics.get('mapPool')!=manifest:raise ValueError('map pool changed; create new experiment')
        metrics.update(trainingProtocol='hunter-pursuit-v2' if protocol=='hunter-pursuit-v2' else 'hunter-capture7-v1',rewardVersion='pursuit-observed-route-v2' if protocol=='hunter-pursuit-v2' else 'capture7-time-motion-v1',runnerPolicy='smart-escape-v1' if protocol=='hunter-pursuit-v2' else 'frozen-waypoint-v1',mapPool=manifest)
    if metrics['seed'] != seed or metrics['maxTicks'] != max_ticks:
        raise ValueError('resume seed/max-ticks must match the saved run')
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    first = len(metrics['generations']) + 1
    for generation in range(first, first + generations):
        folder = output / 'checkpoints' / f'generation-{generation:04d}'
        folder.mkdir(parents=True, exist_ok=True)
        record = {'generation': generation, 'requestedStepsPerSide': steps}
        for side in (('hunter',) if protocol in ('hunter-phase1','hunter-pursuit-v2') else ('runner','hunter')):
            prior = output / 'checkpoints' / f'generation-{generation - 1:04d}'
            if side == 'runner':
                pool = [str(prior / 'hunter-policy.json')] if generation > 1 else []
            else:
                pool = [str(output / 'checkpoints' / f'generation-{g:04d}' / 'runner-policy.json')
                        for g in range(max(1, generation - 3), generation + 1)]
            teammates = [str(prior / 'runner-policy.json')] if side == 'runner' and generation > 1 else []
            if protocol in ('hunter-phase1','hunter-pursuit-v2'):pool=[];teammates=[]
            phase_seed = seed + generation * 2 + int(side == 'hunter')
            random.seed(phase_seed); np.random.seed(phase_seed); torch.manual_seed(phase_seed)
            started = time.monotonic()
            with HunterArenaEnv(side, pool, seed=phase_seed, teammate_pool=teammates, max_ticks=max_ticks,protocol=protocol,hunter_speed_ratio=hunter_speed_ratio,gamma=gamma) as env:
                if protocol=='hunter-pursuit-v2':
                    pursuit_config=env.bridge.request({'op':'pursuit-config'})
                    if resume and metrics.get('spawnPolicy')!=pursuit_config['spawnPolicy']:
                        raise ValueError('resume spawn policy changed; create a new experiment')
                    metrics.update(pursuit_config)
                rollout = min(2048, steps)
                # Exact divisor keeps PPO batches valid for tiny smoke requests too.
                batch = next((size for size in range(min(64, rollout), 1, -1) if rollout % size == 0), rollout)
                if generation > 1:
                    model = MaskablePPO.load(prior / f'{side}.zip', env=env, device='cpu',
                                             n_steps=rollout, batch_size=batch,gamma=gamma)
                    model.set_random_seed(phase_seed)
                else:
                    model = MaskablePPO('MlpPolicy', env, n_steps=rollout, batch_size=batch,
                                        policy_kwargs={'net_arch': [64, 64]}, seed=phase_seed,
                                        device='cpu', verbose=0,gamma=gamma)
                callback = MetricsCallback(output, generation, side, steps,protocol,hunter_speed_ratio)
                model.learn(total_timesteps=steps, callback=callback, reset_num_timesteps=False)
                callback.publish()
                if callback.stopped:
                    print('Stopped safely; interrupted snapshot saved. Resume starts from the last complete generation.', flush=True)
                    return metrics
                model.save(folder / f'{side}.zip')
                policy_path = folder / f'{side}-policy.json'
                export_policy(model, policy_path, {'modelVersion': f'{run_id}-g{generation:04d}-{side}',
                                                   'generation': generation, 'seed': seed,
                                                   'timesteps': model.num_timesteps, 'evaluated': False,'trainingProtocol':metrics.get('trainingProtocol','selfplay'),'hunterSpeedRatio':effective_speed,
                                                   'rewardVersion':metrics.get('rewardVersion','survival-v1'),'codeHash':metrics['codeHash'],'mapPool':metrics.get('mapPool'),'gamma':gamma,'observationSchemaVersion':2 if protocol=='hunter-pursuit-v2' else 1,**({'spawnPolicy':metrics['spawnPolicy'],'spawnPathRange':metrics['spawnPathRange']} if protocol=='hunter-pursuit-v2' else {})})
                while len(callback.observations) < 100:
                    obs, _ = env.reset(seed=170100 + len(callback.observations))
                    callback.observations.append(obs)
                parity = verify_export(model, policy_path, callback.observations[:100], env.bridge)
            record[side] = {'timesteps': model.num_timesteps, 'opponentPool': pool,
                            'teammatePool': teammates, 'parity': parity,
                            'elapsedSeconds': time.monotonic() - started,
                            'meanStepReward': float(np.mean(callback.rewards)),
                            'rewardCurve': [float(np.mean(callback.rewards[i:i + 128]))
                                            for i in range(0, len(callback.rewards), 128)],
                            'episodes': callback.episodes}
            print(f'generation={generation} side={side} steps={model.num_timesteps} parity={parity["maxAbsoluteError"]:.3g}', flush=True)
        metrics['generations'].append(record)
        # Only a complete paired generation becomes the experiment's evaluation candidate.
        for side in (('hunter',) if protocol in ('hunter-phase1','hunter-pursuit-v2') else ('runner','hunter')):
            shutil.copyfile(folder / f'{side}-policy.json', output / f'{side}-policy.json')
            shutil.copyfile(folder / f'{side}-policy.parity.json', output / f'{side}-policy.parity.json')
        write_json(metrics_path, metrics)
    return metrics


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--generations', type=int, default=1)
    parser.add_argument('--steps', type=int, default=250_000)
    parser.add_argument('--seed', type=int, default=1701)
    parser.add_argument('--output', type=Path, default=Path('../public/models/training'))
    parser.add_argument('--max-ticks', type=int, default=2000)
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--run-id')
    parser.add_argument('--protocol',choices=['selfplay','hunter-phase1','hunter-pursuit-v2'],default='selfplay')
    parser.add_argument('--hunter-speed-ratio',type=float,default=1.35)
    args = parser.parse_args()
    train(**vars(args))

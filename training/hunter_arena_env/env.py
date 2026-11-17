import json
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading

import gymnasium as gym
import numpy as np
from .contracts import ACTION_SIZE, OBSERVATION_SIZES, validate_contract

ROOT = Path(__file__).resolve().parents[1]


class TypeScriptBridge:
    """One Node process per env, with bounded reads and explicit error propagation."""
    def __init__(self, timeout=30):
        self.timeout = timeout
        node = shutil.which('node')
        if not node:
            raise RuntimeError('Node.js is required for the TypeScript simulation bridge')
        try:
            cli = subprocess.check_output([node, '-p', "require.resolve('tsx/cli')"],
                                          cwd=ROOT, text=True, encoding='utf-8', timeout=timeout).strip()
        except (subprocess.SubprocessError, OSError) as error:
            raise RuntimeError('TypeScript bridge requires npm install (tsx)') from error
        self.stderr = tempfile.TemporaryFile(mode='w+t', encoding='utf-8')
        self.process = subprocess.Popen([node, cli, str(ROOT / 'bridge.ts')], cwd=ROOT,
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=self.stderr, text=True, encoding='utf-8', bufsize=1)
        self.responses = queue.Queue()
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()
        try:
            self.contract = self.request({'op': 'contract'})
            validate_contract(self.contract)
        except BaseException:
            self.close()
            raise

    def _read(self):
        for line in self.process.stdout:
            self.responses.put(line)
        self.responses.put(None)

    def request(self, message):
        if self.process.poll() is not None:
            raise RuntimeError('TypeScript bridge exited unexpectedly')
        try:
            self.process.stdin.write(json.dumps(message, allow_nan=False) + '\n')
            self.process.stdin.flush()
            line = self.responses.get(timeout=self.timeout)
        except (OSError, queue.Empty) as error:
            self.close()
            raise RuntimeError('TypeScript bridge failed or timed out') from error
        if line is None:
            self.stderr.seek(0)
            raise RuntimeError('TypeScript bridge closed: ' + self.stderr.read()[-4000:])
        response = json.loads(line)
        if not response.get('ok'):
            raise RuntimeError('TypeScript bridge: ' + response.get('error', 'unknown failure'))
        return response['data']

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.reader.join(timeout=2)
        for stream in (self.process.stdin, self.process.stdout, self.stderr):
            stream.close()


class HunterArenaEnv(gym.Env):
    metadata = {'render_modes': []}

    def __init__(self, side, opponent_pool=None, seed=None, *, teammate_pool=None,
                 max_ticks=2000, gamma=.99, protocol='selfplay', hunter_speed_ratio=1.35, seed_domain='train'):
        if side not in OBSERVATION_SIZES:
            raise ValueError('side must be runner or hunter')
        if not isinstance(max_ticks, int) or max_ticks < 1:
            raise ValueError('max_ticks must be a positive integer')
        if not 0 <= gamma <= 1:
            raise ValueError('gamma must be between zero and one')
        self.side, self.initial_seed = side, seed
        if protocol not in ('selfplay','hunter-phase1','hunter-pursuit-v2') or protocol in ('hunter-phase1','hunter-pursuit-v2') and side!='hunter':
            raise ValueError('invalid protocol/side')
        if not isinstance(hunter_speed_ratio,(int,float)) or not .5<=hunter_speed_ratio<=3:
            raise ValueError('hunter speed ratio must be .5..3')
        self.protocol,self.hunter_speed_ratio,self.episode_index=protocol,hunter_speed_ratio,0
        if seed_domain not in ('train','evaluation'):raise ValueError('invalid seed domain')
        self.seed_domain=seed_domain
        self.opponent_pool = [str(Path(path).resolve()) for path in (opponent_pool or [])]
        self.teammate_pool = [str(Path(path).resolve()) for path in (teammate_pool or [])]
        self.max_ticks, self.gamma = max_ticks, gamma
        self.observation_space = gym.spaces.Box(-np.inf, np.inf, (325 if protocol=='hunter-pursuit-v2' else OBSERVATION_SIZES[side],), np.float32)
        self.action_space = gym.spaces.Discrete(ACTION_SIZE)
        self.bridge = TypeScriptBridge()
        if protocol=='hunter-pursuit-v2':
            contract=self.bridge.request({'op':'contract','protocol':protocol})
            try:
                validate_contract(contract, protocol=protocol)
            except ValueError:
                self.bridge.close()
                raise
        self.done = True
        self._mask = np.zeros(ACTION_SIZE, dtype=bool)
        self.closed = False

    def _unpack(self, response):
        observation = np.asarray(response['observation'], dtype=np.float32)
        if not self.observation_space.contains(observation) or not np.isfinite(observation).all():
            raise RuntimeError('invalid observation from TS bridge')
        self._mask = np.asarray(response['mask'], dtype=bool)
        if self._mask.shape != (ACTION_SIZE,) or not self._mask.any():
            raise RuntimeError('invalid action mask from TS bridge')
        return observation, response['info']

    def reset(self, *, seed=None, options=None):
        if self.closed:
            raise RuntimeError('environment is closed')
        if seed is None:
            seed = self.initial_seed
        self.initial_seed = None
        super().reset(seed=seed)
        world_seed = int(seed if seed is not None else self.np_random.integers(0, 2**31))
        if self.protocol in ('hunter-phase1','hunter-pursuit-v2'):world_seed=world_seed%1_000_000_000+(1_000_000_000 if self.seed_domain=='evaluation' else 0)
        choose = lambda pool: pool[int(self.np_random.integers(len(pool)))] if pool else None
        runner_index = (options or {}).get('runner_index', int(self.np_random.integers(8)))
        if not isinstance(runner_index, int) or not 0 <= runner_index < 8:
            raise ValueError('runner_index must be in 0..7')
        response = self.bridge.request({'op': 'reset', 'side': self.side, 'seed': world_seed,
                                       'protocol':self.protocol,'hunterSpeedRatio':self.hunter_speed_ratio,
                                       'seedDomain':self.seed_domain,
                                       'mapId':(options or {}).get('map_id',f'{self.episode_index%10+1:02d}'),
                                       'runnerIndex': runner_index, 'maxTicks': self.max_ticks,
                                       'opponent': choose(self.opponent_pool), 'teammate': choose(self.teammate_pool),
                                       'gamma': self.gamma})
        self.episode_index+=1
        self.done = False
        return self._unpack(response)

    def action_masks(self):
        return self._mask.copy()

    def step(self, action):
        if self.done:
            raise RuntimeError('episode ended; reset required')
        if not self.action_space.contains(action) or not self._mask[int(action)]:
            raise ValueError(f'illegal action {action}')
        response = self.bridge.request({'op': 'step', 'action': int(action)})
        observation, info = self._unpack(response)
        terminated, truncated = response['terminated'], response['truncated']
        self.done = terminated or truncated
        return observation, float(response['reward']), terminated, truncated, info

    def close(self):
        if not self.closed:
            self.bridge.close()
            self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

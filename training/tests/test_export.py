import importlib.util
import numpy as np


def test_export_matches_typescript_for_100_real_observations(tmp_path):
    assert importlib.util.find_spec('hunter_arena_env.export'), 'MLP exporter is not implemented'
    from hunter_arena_env.env import HunterArenaEnv
    from hunter_arena_env.export import export_policy, verify_export
    from sb3_contrib import MaskablePPO
    for side in ('runner', 'hunter'):
        with HunterArenaEnv(side, max_ticks=8) as env:
            model = MaskablePPO('MlpPolicy', env, n_steps=8, batch_size=8, seed=4,
                                policy_kwargs={'net_arch': [32, 32]}, device='cpu')
            observations = []
            for seed in range(100):
                obs, _ = env.reset(seed=seed)
                observations.append(obs)
            path = tmp_path / f'{side}.json'
            export_policy(model, path, {'modelVersion': 'parity-test'})
            result = verify_export(model, path, np.asarray(observations), env.bridge)
            assert result['count'] == 100 and result['maxAbsoluteError'] < 1e-5
            assert path.with_suffix('.parity.json').exists()

import importlib.util
import json
from pathlib import Path
import numpy as np
import pytest


def env_type():
    assert importlib.util.find_spec('hunter_arena_env.env'), 'Gymnasium bridge is not implemented'
    from hunter_arena_env.env import HunterArenaEnv
    return HunterArenaEnv


@pytest.mark.parametrize('side,size', [('runner', 316), ('hunter', 313)])
def test_contract_determinism_mask_and_rewards(side, size):
    with env_type()(side, seed=1701, max_ticks=8) as env:
        first, info = env.reset(seed=1701)
        mask = env.action_masks()
        assert first.shape == (size,) and env.action_space.n == 18
        assert mask.dtype == bool and mask[0]
        if side == 'hunter':
            assert not mask[9:].any()
        transition = env.step(0)
        repeat, _ = env.reset(seed=1701)
        np.testing.assert_array_equal(first, repeat)
        again = env.step(0)
        np.testing.assert_array_equal(transition[0], again[0])
        assert transition[1:] == again[1:]
        terms = again[4]['reward_breakdown']
        assert again[1] == pytest.approx(sum(v for k, v in terms.items() if k != 'total'))
        if side == 'hunter':
            with pytest.raises(ValueError, match='illegal'):
                env.step(9)


def test_one_hundred_episodes_end_and_reject_post_terminal_steps():
    with env_type()('hunter', max_ticks=2) as env:
        for seed in range(100):
            env.reset(seed=seed)
            for _ in range(3):
                _, _, terminated, truncated, info = env.step(0)
                if terminated or truncated:
                    break
            assert terminated or truncated
            assert info['result']['reason'] in ('timeout', 'last-survivor', 'all-eliminated')
            with pytest.raises(RuntimeError, match='reset'):
                env.step(0)


@pytest.mark.parametrize('side', ['runner', 'hunter'])
@pytest.mark.parametrize('explicit_seed', [None, 1701, 42])
def test_first_reset_consumes_constructor_seed_and_preserves_rng_sequence(side, explicit_seed):
    with env_type()(side, seed=1701) as env, env_type()(side) as reference:
        effective_seed = 1701 if explicit_seed is None else explicit_seed
        first, first_info = env.reset(seed=explicit_seed)
        expected, expected_info = reference.reset(seed=effective_seed)
        np.testing.assert_array_equal(first, expected)
        assert first_info == expected_info
        for _ in range(3):
            observation, info = env.reset()
            expected, expected_info = reference.reset()
            assert info['map_hash'] == expected_info['map_hash']
            assert info['map_hash'] != first_info['map_hash']
            np.testing.assert_array_equal(observation, expected)
            assert info == expected_info


def test_bridge_crash_and_protocol_mismatch_fail_fast():
    from hunter_arena_env.contracts import validate_contract
    with pytest.raises(ValueError, match='contract'):
        validate_contract({'protocolVersion': 99})
    with env_type()('hunter') as env:
        env.reset(seed=10)
        env.bridge.process.kill()
        env.bridge.process.wait(timeout=5)
        with pytest.raises(RuntimeError, match='bridge'):
            env.step(0)


def test_fixed_typescript_fixture_parity():
    fixture = json.loads((Path(__file__).parent / 'fixtures' / 'contract-v1.json').read_text())
    for case in fixture['cases']:
        with env_type()(case['side'], max_ticks=case['maxTicks']) as env:
            observation, info = env.reset(seed=case['seed'], options={'runner_index': 0})
            assert info['map_hash'] == case['mapHash']
            np.testing.assert_allclose(observation, case['observation'], atol=1e-7)
            assert env.action_masks().tolist() == case['mask']
            _, reward, terminated, truncated, info = env.step(0)
            assert info['reward_breakdown'] == case['reward']
            assert reward == case['reward']['total']

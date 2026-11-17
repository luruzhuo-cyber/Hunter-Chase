import json
import subprocess
import sys
from pathlib import Path

import pytest
from hunter_arena_env.env import HunterArenaEnv


def test_pursuit_protocol_is_distinct_and_hunter_only():
    with HunterArenaEnv('hunter', protocol='hunter-pursuit-v2', max_ticks=4) as env:
        obs, info = env.reset(seed=123, options={'map_id': '01'})
        assert obs.shape == (325,)
        assert info['trainingProtocol'] == 'hunter-pursuit-v2'
        assert info['runnerPolicy'] == 'smart-escape-v1'
        assert info['spawnPolicy'] == 'reachable-path-8-35-v1'
        assert env.action_masks()[9:].sum() == 0
        assert info['pursuit']['switchCount'] == 0
    with pytest.raises(ValueError):
        HunterArenaEnv('runner', protocol='hunter-pursuit-v2')


def test_pursuit_train_resume_evaluate_keeps_v2_contract(tmp_path):
    root = Path(__file__).parents[1]
    args = [sys.executable, 'train.py', '--protocol', 'hunter-pursuit-v2', '--steps', '8',
            '--max-ticks', '4', '--output', str(tmp_path), '--run-id', 'pursuit-test']
    subprocess.run(args, cwd=root, check=True, timeout=90)
    metrics = json.loads((tmp_path / 'metrics.json').read_text(encoding='utf-8'))
    model = json.loads((tmp_path / 'hunter-policy.json').read_text(encoding='utf-8'))
    assert metrics['trainingProtocol'] == 'hunter-pursuit-v2'
    assert metrics['observationSchemaVersion'] == 2
    assert metrics['network']['hunterObservationSize'] == 325
    assert model['observationSize'] == 325
    assert model['metadata']['observationSchemaVersion'] == 2
    assert metrics['spawnPolicy'] == model['metadata']['spawnPolicy'] == 'reachable-path-8-35-v1'
    assert not (tmp_path / 'runner-policy.json').exists()
    subprocess.run(args + ['--resume'], cwd=root, check=True, timeout=90)
    from evaluate import evaluate
    report = evaluate(protocol='hunter-pursuit-v2', hunter_policy=tmp_path/'hunter-policy.json',
                      seeds=[1, 2], max_ticks=4, verify_determinism=True)
    assert report['episodeCount'] == 2 and report['determinismVerified']
    assert report['runnerPolicy'] == 'smart-escape-v1'
    assert report['trainingProtocol'] == 'hunter-pursuit-v2'
    assert report['spawnPolicy'] == metrics['spawnPolicy']


def test_console_pursuit_evaluation_preserves_protocol_and_runner_baseline(tmp_path, monkeypatch):
    from console_service import RunManager
    manager = RunManager(tmp_path)
    run = manager.create({'protocol': 'hunter-pursuit-v2', 'steps': 16})
    folder = manager.folder(run['id'])
    (folder/'hunter-policy.json').write_text('{}')
    calls = []
    monkeypatch.setattr(manager, '_launch', lambda run_id, kind, args: calls.append(args))
    manager.evaluate(run['id'], 10)
    context = json.loads((folder/'latest-evaluation.json').read_text(encoding='utf-8'))
    assert context['protocol'] == 'hunter-pursuit-v2'
    assert context['runnerRunId'] == 'smart-escape-v1'
    assert calls[0][calls[0].index('--protocol')+1] == 'hunter-pursuit-v2'
    assert '--runner-policy' not in calls[0]

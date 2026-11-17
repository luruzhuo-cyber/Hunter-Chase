import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import pytest


@pytest.mark.parametrize('steps', [8, 67])
def test_smoke_and_resume_preserve_frozen_generations(tmp_path, steps):
    assert importlib.util.find_spec('train'), 'alternating training is not implemented'
    root = Path(__file__).resolve().parents[1]
    command = [sys.executable, str(root / 'train.py'), '--generations', '1', '--steps', str(steps),
               '--max-ticks', '4', '--output', str(tmp_path), '--seed', '12']
    subprocess.run(command, cwd=root, check=True, timeout=180)
    metrics = json.loads((tmp_path / 'metrics.json').read_text())
    assert len(metrics['generations']) == 1
    runner_snapshot = tmp_path / 'checkpoints' / 'generation-0001' / 'runner-policy.json'
    before = runner_snapshot.read_bytes()
    assert metrics['generations'][0]['hunter']['opponentPool'] == [str(runner_snapshot)]
    subprocess.run(command + ['--resume'], cwd=root, check=True, timeout=180)
    assert runner_snapshot.read_bytes() == before
    metrics = json.loads((tmp_path / 'metrics.json').read_text())
    assert len(metrics['generations']) == 2
    assert len(metrics['generations'][1]['hunter']['opponentPool']) == 2
    assert metrics['generations'][1]['runner']['timesteps'] > metrics['generations'][0]['runner']['timesteps']
    for side in ('runner', 'hunter'):
        assert (tmp_path / f'{side}-policy.json').exists()
        assert (tmp_path / 'checkpoints' / 'generation-0002' / f'{side}.zip').exists()
        parity = json.loads((tmp_path / f'{side}-policy.parity.json').read_text())
        assert len(parity['observations']) == 100

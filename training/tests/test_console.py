import json
import pytest
from console_service import RunManager, validate_config
from console_service import make_handler
from http.server import ThreadingHTTPServer
import threading
from urllib.request import Request, urlopen
from urllib.error import HTTPError


def test_config_rejects_arbitrary_commands_and_bounds():
    assert validate_config({'steps': 64, 'generations': 1, 'seed': 4})['steps'] == 64
    for config in ({'steps': -1}, {'generations': 9999}, {'command': 'evil'}, {'seed': 'x'}, {'max_ticks': 0}):
        with pytest.raises(ValueError):
            validate_config(config)


def test_isolated_runs_and_path_validation(tmp_path):
    manager = RunManager(tmp_path)
    a, b = manager.create({'steps': 64}), manager.create({'steps': 64})
    assert a['id'] != b['id']
    assert manager.detail(a['id'])['status'] == 'created'
    assert len(manager.list_runs()) == 2
    with pytest.raises(ValueError):
        manager.detail('../escape')
    with pytest.raises(ValueError, match='完整'):
        manager.start(a['id'], resume=True)


def test_evaluation_uses_only_owned_models_and_fixed_command(tmp_path):
    manager = RunManager(tmp_path)
    run = manager.create({'protocol':'selfplay'})
    with pytest.raises(ValueError, match='模型'):
        manager.evaluate(run['id'], 5)
    with pytest.raises(ValueError):
        manager.evaluate(run['id'], 0)


def test_frozen_opponent_uses_immutable_pair_and_retains_history(tmp_path, monkeypatch):
    manager=RunManager(tmp_path)
    a,b=manager.create({'protocol':'selfplay'}),manager.create({'protocol':'selfplay'})
    for run in [a,b]:
        for role in ['runner','hunter']:
            (manager.folder(run['id']) / f'{role}-policy.json').write_text(run['id']+'-'+role)
    calls=[]
    monkeypatch.setattr(manager,'_launch',lambda run_id,kind,args:calls.append(args))
    manager.evaluate(a['id'],2,side='runner',opponent_id=b['id'])
    folder=manager.folder(a['id'])
    first=json.loads((folder/'latest-evaluation.json').read_text())
    snapshot=folder/'evaluations'/first['id']
    assert (snapshot/'runner-policy.json').read_text()==a['id']+'-runner'
    assert (snapshot/'hunter-policy.json').read_text()==b['id']+'-hunter'
    (manager.folder(b['id'])/'hunter-policy.json').write_text('new-hunter')
    assert (snapshot/'hunter-policy.json').read_text()==b['id']+'-hunter'
    manager.evaluate(a['id'],2,side='pair')
    assert snapshot.exists()
    second=json.loads((folder/'latest-evaluation.json').read_text())
    assert first['id']!=second['id']
    assert calls[0][calls[0].index('--hunter-policy')+1]==str(snapshot/'hunter-policy.json')


def test_compare_does_not_attribute_reference_runner_to_hunter_candidate(tmp_path):
    manager=RunManager(tmp_path)
    a,b=manager.create({'protocol':'selfplay'}),manager.create({'protocol':'selfplay'})
    for run in [a,b]:
        folder=manager.folder(run['id'])
        context={'id':'eval-test','targetSide':'hunter','runnerRunId':'frozen-runner','hunterRunId':run['id']}
        destination=folder/'evaluations'/'eval-test';destination.mkdir(parents=True)
        (folder/'latest-evaluation.json').write_text(json.dumps(context))
        (destination/'result.json').write_text(json.dumps({'codeHash':'fixture-v1','maxTicks':3600,'seeds':[1,2],'hunterModelSha256':'h1','runnerModelSha256':'r1'}))
    rows=manager.compare([a['id'],b['id']])
    assert rows[0]['hunterComparable']
    assert not rows[0]['runnerComparable']
    assert rows[0]['evaluationContext']['runnerRunId']=='frozen-runner'


def test_comparison_does_not_invent_missing_results(tmp_path):
    manager = RunManager(tmp_path)
    a, b = manager.create({'protocol':'selfplay'}), manager.create({'protocol':'selfplay'})
    assert manager.compare([a['id'], b['id']])[0]['evaluation'] is None
    for run, hunter in [(a,'h1'),(b,'h2')]:
        folder = manager.folder(run['id'])
        (folder / 'evaluation.json').write_text(json.dumps({'codeHash':'fixture-v1','maxTicks':3600,'seeds':[1,2], 'hunterModelSha256':hunter, 'runnerModelSha256':'r1'}))
    rows=manager.compare([a['id'],b['id']])
    assert rows[0]['sameScenario']
    assert rows[0]['hunterComparable']
    assert not rows[0]['runnerComparable']
    assert not rows[0]['comparable']


def test_local_api_requires_origin_host_and_token(tmp_path):
    manager = RunManager(tmp_path)
    server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(manager, 'test-token', 0))
    port = server.server_address[1]
    server.RequestHandlerClass = make_handler(manager, 'test-token', port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f'http://127.0.0.1:{port}'
    try:
        assert b'__TOKEN__' not in urlopen(url).read()
        for headers in ({}, {'X-Console-Token': 'test-token', 'Origin': 'http://evil.example'}, {'X-Console-Token': 'test-token', 'Host': 'evil.example'}):
            with pytest.raises(HTTPError) as error:
                urlopen(Request(url + '/api/runs', data=b'{}', headers=headers))
            assert error.value.code == 403
        request = Request(url + '/api/runs', data=b'{"steps":64}', headers={'X-Console-Token':'test-token'})
        run = json.load(urlopen(request))
        assert json.load(urlopen(url + '/api/runs/' + run['id']))['config']['steps'] == 64
    finally:
        server.shutdown()
        server.server_close()


def test_controlled_job_lifecycle_and_single_worker(tmp_path, monkeypatch):
    manager = RunManager(tmp_path)
    a, b = manager.create({'protocol':'selfplay'}), manager.create({'protocol':'selfplay'})
    # A real tiny Python process, not PPO, tests process ownership and lifecycle.
    job = manager._launch(a['id'], 'evaluation', ['-c', 'import time; print("running", flush=True); time.sleep(10)'])
    try:
        assert job['status'] == 'running'
        with pytest.raises(ValueError, match='已有任务'):
            manager._launch(b['id'], 'evaluation', ['-c', 'pass'])
        manager.stop(a['id'])
        manager.process.wait(timeout=5)
    finally:
        manager.close()


def test_callback_publishes_live_data_and_stops_with_snapshot(tmp_path):
    from train import MetricsCallback
    from types import SimpleNamespace
    import numpy as np
    class Model:
        logger = SimpleNamespace(name_to_value={'train/approx_kl': .02, 'train/loss': float('nan')})
        def save(self, path):
            path.with_suffix('.zip').write_text('snapshot')
    callback = MetricsCallback(tmp_path, 2, 'hunter', 64)
    callback.model = Model()
    callback.num_timesteps = 16
    callback.n_calls = 16
    callback.locals = {'rewards': np.array([.1]), 'new_obs': np.zeros((1,313)), 'infos':[{'reward_breakdown': {'capture': .2, 'total': .1}}]}
    assert callback._on_step()
    callback.publish()
    live = json.loads((tmp_path / 'live.json').read_text())
    assert live['generation'] == 2 and live['fps'] > 0
    assert live['diagnostics'] == {'train/approx_kl': .02}
    (tmp_path / 'stop.request').write_text('stop')
    assert callback._on_step() is False
    assert (tmp_path / 'interrupted-hunter.zip').exists()

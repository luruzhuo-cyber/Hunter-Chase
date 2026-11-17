import json
import pytest
from console_service import RunManager,validate_config

def test_new_tasks_default_hunter_only_and_speed_is_validated():
    assert validate_config({})['protocol']=='hunter-phase1'
    assert validate_config({})['hunter_speed_ratio']==1.35
    for value in [0,4,'fast',True]:
        with pytest.raises(ValueError):validate_config({'hunter_speed_ratio':value})

def test_source_snapshot_contains_both_authoritative_ts_entrypoints(tmp_path):
    manager=RunManager(tmp_path);run=manager.create({});folder=manager.folder(run['id']);runtime=manager.snapshot_source(folder)
    assert (runtime/'bridge.ts').exists() and (runtime/'phase1.ts').exists()
    original=(runtime/'phase1.ts').read_bytes();assert manager.snapshot_source(folder)==runtime
    assert (runtime/'phase1.ts').read_bytes()==original

def test_phase1_freezes_only_hunter_and_retains_protocol_provenance(tmp_path,monkeypatch):
    manager=RunManager(tmp_path);run=manager.create({});folder=manager.folder(run['id'])
    (folder/'hunter-policy.json').write_text('{}')
    calls=[];monkeypatch.setattr(manager,'_launch',lambda run_id,kind,args:calls.append(args))
    manager.evaluate(run['id'],10)
    context=json.loads((folder/'latest-evaluation.json').read_text());snapshot=folder/'evaluations'/context['id']
    assert (snapshot/'hunter-policy.json').exists() and not (snapshot/'runner-policy.json').exists()
    assert context['runnerRunId']=='frozen-waypoint-v1'
    assert '--runner-policy' not in calls[0]
    assert calls[0][calls[0].index('--protocol')+1]=='hunter-phase1'

def test_compare_rejects_different_frozen_source(tmp_path):
    manager=RunManager(tmp_path);a,b=manager.create({}),manager.create({})
    for run,code in [(a,'aaa'),(b,'bbb')]:
        folder=manager.folder(run['id']);destination=folder/'evaluations'/'eval-check';destination.mkdir(parents=True)
        (folder/'latest-evaluation.json').write_text(json.dumps({'id':'eval-check','targetSide':'hunter','runnerRunId':'frozen-waypoint-v1','hunterRunId':run['id']}))
        (destination/'result.json').write_text(json.dumps({'maxTicks':3600,'seeds':[1,2],'codeHash':code,'runnerModelSha256':'frozen-waypoint-v1','hunterModelSha256':'h1'}))
    assert not manager.compare([a['id'],b['id']])[0]['hunterComparable']

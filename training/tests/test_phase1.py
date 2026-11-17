import json
import subprocess
import sys
from pathlib import Path
import pytest
from hunter_arena_env.env import HunterArenaEnv

def test_phase1_map_pool_and_disabled_skills():
    with HunterArenaEnv('hunter',protocol='hunter-phase1') as env:
        maps=env.bridge.request({'op':'maps'})
        assert [m['id'] for m in maps]==[f'{i:02d}' for i in range(1,11)]
        _,a=env.reset(seed=1,options={'map_id':'01'})
        _,b=env.reset(seed=2,options={'map_id':'01'})
        assert a['map_hash']==b['map_hash']
        assert a['hunterSpeedRatio']==1.35
        with pytest.raises(ValueError):HunterArenaEnv('runner',protocol='hunter-phase1')
        _,training=env.reset(seed=1_250_000_000)
        assert training['routeSeed']==250_000_000 and training['seedDomain']=='train'
    with HunterArenaEnv('hunter',protocol='hunter-phase1',seed_domain='evaluation') as env:
        _,testing=env.reset(seed=250_000_000)
        assert testing['routeSeed']==1_250_000_000 and testing['seedDomain']=='evaluation'

def test_phase1_hunter_only_train_resume_and_permap_eval(tmp_path):
    root=Path(__file__).parents[1]
    args=[sys.executable,'train.py','--protocol','hunter-phase1','--steps','8','--max-ticks','4','--output',str(tmp_path),'--run-id','phase1-test']
    subprocess.run(args,cwd=root,check=True,timeout=90)
    assert not (tmp_path/'runner-policy.json').exists()
    metrics=json.loads((tmp_path/'metrics.json').read_text())
    assert metrics['trainingProtocol']=='hunter-capture7-v1'
    assert metrics['gamma']==.999
    assert 'runner' not in metrics['generations'][0]
    subprocess.run(args+['--resume'],cwd=root,check=True,timeout=90)
    from evaluate import evaluate
    report=evaluate(protocol='hunter-phase1',hunter_policy=tmp_path/'hunter-policy.json',seeds=list(range(1,11)),max_ticks=4,verify_determinism=True)
    assert report['episodeCount']==10 and len(report['perMap'])==10
    assert all(row['episodes']==1 for row in report['perMap'])
    assert metrics['mapPool']==report['mapPool']
    assert report['runnerPolicy']=='frozen-waypoint-v1' and report['determinismVerified']
    assert all(ep['seed']>=1_000_000_000 for ep in report['episodes'])

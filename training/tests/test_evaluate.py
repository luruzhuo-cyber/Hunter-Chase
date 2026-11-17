import importlib.util
from pathlib import Path


def test_fixed_seed_evaluation_includes_all_eight_runners():
    assert importlib.util.find_spec('evaluate'), 'fixed-seed evaluation is missing'
    from evaluate import evaluate
    first = evaluate(seeds=[42, 1701], max_ticks=4)
    second = evaluate(seeds=[42, 1701], max_ticks=4)
    assert first == second
    assert first['episodeCount'] == 2
    assert first['timeouts'] == 2
    assert first['discoveryCount'] >= 0 and first['lostTargetCount'] >= 0
    assert len(first['runners']) == 8
    for runner in first['runners']:
        assert runner['lastSurvivorRate'] == 0
        assert runner['meanSurvivalSeconds'] == .4
        assert runner['medianSurvivalSeconds'] == .4
        assert runner['blockedMoveTicks'] >= 0


def test_evaluation_binds_exact_models_and_can_emit_determinism_evidence(tmp_path):
    from evaluate import evaluate
    models=Path(__file__).parents[2]/'public'/'models'/'smoke';runner=models/'runner-policy.json';hunter=models/'hunter-policy.json'
    report=evaluate(runner_policy=runner,hunter_policy=hunter,seeds=[1,2],max_ticks=1,verify_determinism=True)
    assert report['runnerPolicy']=='ppo-g0001-runner' and report['hunterPolicy']=='ppo-g0001-hunter'
    assert len(report['runnerModelSha256'])==64 and len(report['hunterModelSha256'])==64
    assert report['determinismVerified'] is True and report['repeatabilityMismatches']==0
    assert [episode['seed'] for episode in report['episodes']]==[1,2]

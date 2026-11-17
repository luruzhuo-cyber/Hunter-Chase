import hashlib
import json
from pathlib import Path
import pytest

from promote_models import promote


def write_candidate(root: Path):
    root.mkdir()
    for side, size in [('runner', 316), ('hunter', 313)]:
        (root / f'{side}-policy.json').write_text(json.dumps({'schemaVersion': 1, 'modelVersion': f'g7-{side}', 'observationSize': size, 'actionSize': 18}), encoding='utf-8')
    (root / 'metrics.json').write_text('{}', encoding='utf-8')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def evaluation(candidate: Path, seeds=(1, 2), timeout=False):
    episodes=[]
    for seed in seeds:
        episodes.append({'seed': seed, 'result': {'winnerKind': 'none' if timeout else 'runner', 'winnerId': None if timeout else '01', 'reason': 'timeout' if timeout else 'last-survivor', 'tick': 8 if timeout else 4},
                         'runners': [{'id': f'{i:02d}', 'survivalSeconds': .4} for i in range(1, 9)]})
    return {'schemaVersion': 1, 'episodeCount': len(episodes), 'seeds': list(seeds), 'maxTicks': 8, 'episodes': episodes,
            'runnerPolicy': 'g7-runner', 'hunterPolicy': 'g7-hunter',
            'runnerModelSha256': digest(candidate / 'runner-policy.json'), 'hunterModelSha256': digest(candidate / 'hunter-policy.json'),
            'determinismVerified': True, 'repeatabilityMismatches': 0, 'timeouts': len(episodes) if timeout else 0}


def save(path: Path, data): path.write_text(json.dumps(data), encoding='utf-8')


def test_promotes_only_exact_candidate_with_complete_deterministic_fixed_seeds(tmp_path):
    candidate=tmp_path/'candidate';write_candidate(candidate);report=tmp_path/'evaluation.json';save(report,evaluation(candidate));destination=tmp_path/'current'
    manifest=promote(candidate,report,destination,2)
    assert manifest['accepted'] is True and manifest['fixedSeeds'] == [1,2]
    assert json.loads((destination/'manifest.json').read_text())['runnerModelSha256'] == digest(candidate/'runner-policy.json')


@pytest.mark.parametrize('mutation,match', [
    (lambda e: e.update(runnerModelSha256='0'*64), 'hash'),
    (lambda e: e.update(runnerPolicy='other-runner'), 'version'),
    (lambda e: e.update(seeds=[1]), 'fixed seed'),
    (lambda e: e.update(seeds=[1,1]), 'duplicate'),
    (lambda e: e.update(determinismVerified=False), 'determinism'),
    (lambda e: e.update(repeatabilityMismatches=1), 'determinism'),
])
def test_rejects_stale_unrelated_incomplete_duplicate_or_nondeterministic_evaluation(tmp_path, mutation, match):
    candidate=tmp_path/'candidate';write_candidate(candidate);data=evaluation(candidate);mutation(data);report=tmp_path/'evaluation.json';save(report,data)
    with pytest.raises(ValueError, match=match): promote(candidate,report,tmp_path/'current',2)


def test_rejects_all_timeout_and_malformed_episode_results(tmp_path):
    candidate=tmp_path/'candidate';write_candidate(candidate);report=tmp_path/'evaluation.json';save(report,evaluation(candidate,timeout=True))
    with pytest.raises(ValueError, match='timeout'): promote(candidate,report,tmp_path/'current',2)
    data=evaluation(candidate);data['episodes'][0]['result']['reason']='unknown';save(report,data)
    with pytest.raises(ValueError, match='result'): promote(candidate,report,tmp_path/'current',2)
    data=evaluation(candidate);data['episodes'][0]['result'].update(winnerKind='hunter', winnerId=None);save(report,data)
    with pytest.raises(ValueError, match='result'): promote(candidate,report,tmp_path/'current',2)

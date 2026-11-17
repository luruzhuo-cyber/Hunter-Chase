"""Fixed-seed full-game evaluation; never promotes a model to browser default."""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import os
import numpy as np
from phase1_metrics import summary as phase1_summary
from hunter_arena_env.env import HunterArenaEnv

FIXED_SEEDS = [42, 1701, 2026, 9001, 31415]


def _evaluate_once(runner_policy=None, hunter_policy=None, seeds=None, max_ticks=2000,protocol='selfplay',hunter_speed_ratio=1.35):
    seeds = FIXED_SEEDS if seeds is None else list(seeds)
    if not seeds:
        raise ValueError('evaluation requires at least one seed')
    if protocol in ('hunter-phase1','hunter-pursuit-v2') and (len(set(seeds))!=len(seeds) or any(type(seed) is not int or not 0<=seed<1_000_000_000 for seed in seeds)):
        raise ValueError('phase1 evaluation seeds must be unique integers in [0, 1e9)')
    runner = json.loads(Path(runner_policy).read_text()) if runner_policy else None
    hunter = json.loads(Path(hunter_policy).read_text()) if hunter_policy else None
    if protocol in ('hunter-phase1','hunter-pursuit-v2') and hunter:
        metadata=hunter.get('metadata',{})
        if metadata.get('trainingProtocol')!=('hunter-pursuit-v2' if protocol=='hunter-pursuit-v2' else 'hunter-capture7-v1') or metadata.get('hunterSpeedRatio')!=hunter_speed_ratio:
            raise ValueError('hunter model protocol/speed differs from evaluation configuration')
        if protocol=='hunter-pursuit-v2' and (hunter.get('observationSize')!=325 or metadata.get('observationSchemaVersion')!=2):
            raise ValueError('pursuit V2 requires observation schema 2 with 325 inputs; legacy models are incompatible')
    episodes = []
    map_pool=None
    pursuit_config={}
    with HunterArenaEnv('hunter', [runner_policy] if runner_policy else [], max_ticks=max_ticks,protocol=protocol,hunter_speed_ratio=hunter_speed_ratio,seed_domain='evaluation') as env:
        if protocol in ('hunter-phase1','hunter-pursuit-v2'):map_pool=env.bridge.request({'op':'maps'})
        if protocol=='hunter-pursuit-v2':
            pursuit_config=env.bridge.request({'op':'pursuit-config'})
            if hunter and hunter.get('metadata',{}).get('spawnPolicy')!=pursuit_config['spawnPolicy']:
                raise ValueError('hunter model spawn policy differs from evaluation configuration')
        for index,seed in enumerate(seeds):
            route_seed=1_000_000_000+seed%1_000_000_000 if protocol in ('hunter-phase1','hunter-pursuit-v2') else seed
            observation, _ = env.reset(seed=route_seed,options={'map_id':f'{index%10+1:02d}'})
            rng = np.random.default_rng(seed)
            while True:
                mask = env.action_masks()
                if hunter:
                    logits = env.bridge.request({'op': 'logits', 'model': hunter, 'observations': [observation.tolist()]})[0]
                    action = int(np.argmax(np.where(mask, logits, -np.inf)))
                else:
                    action = int(rng.choice(np.flatnonzero(mask)))
                observation, _, terminated, truncated, info = env.step(action)
                if terminated or truncated:
                    episode = info['episode_stats']
                    episode['seed'] = route_seed
                    episode['evaluationSeed']=seed
                    episodes.append(episode)
                    break
    runners = []
    for index in range(8):
        samples = [episode['runners'][index] for episode in episodes]
        timings = [r['skillTick'] * .1 for r in samples if r['skillTick'] is not None]
        post = [r['postSkillSurvivalSeconds'] for r in samples if r['postSkillSurvivalSeconds'] is not None]
        runners.append({'id': samples[0]['id'],
                        'meanSurvivalSeconds': statistics.mean(r['survivalSeconds'] for r in samples),
                        'medianSurvivalSeconds': statistics.median(r['survivalSeconds'] for r in samples),
                        'lastSurvivorRate': sum(ep['result'].get('winnerId') == samples[0]['id'] for ep in episodes) / len(episodes),
                        'skillUseRate': sum(r['skillUsed'] for r in samples) / len(samples),
                        'meanSkillTimeSeconds': statistics.mean(timings) if timings else None,
                        'meanPostSkillSurvivalSeconds': statistics.mean(post) if post else None,
                        'captures': sum(r['eliminationReason'] == 'capture' for r in samples),
                        'blockedMoveTicks': sum(r['blockedMoveTicks'] for r in samples),
                        'exposureEliminations': sum(r['eliminationReason'] == 'exposure' for r in samples)})
    all_eliminated = [ep['result']['tick'] * .1 for ep in episodes if ep['result']['reason'] == 'all-eliminated']
    result={'schemaVersion': 1, 'seeds': seeds, 'maxTicks': max_ticks, 'episodeCount': len(episodes),'codeHash':os.environ.get('HUNTER_CODE_HASH','direct-script-no-snapshot'),
            'hunterPolicy': hunter.get('modelVersion') if hunter else 'seeded-random-legal-baseline',
            'runnerPolicy': runner.get('modelVersion') if runner else 'reward-lookahead-v2',
            'hunterModelSha256': hashlib.sha256(Path(hunter_policy).read_bytes()).hexdigest() if hunter_policy else None,
            'runnerModelSha256': hashlib.sha256(Path(runner_policy).read_bytes()).hexdigest() if runner_policy else None,
            'hunterAllEliminatedRate': len(all_eliminated) / len(episodes),
            'meanAllEliminatedSeconds': statistics.mean(all_eliminated) if all_eliminated else None,
            'timeouts': sum(ep['result']['reason'] == 'timeout' for ep in episodes),
            'discoveryCount': sum(ep['discoveryCount'] for ep in episodes),
            'lostTargetCount': sum(ep['lostTargetCount'] for ep in episodes),
            'hunterBlockedMoveTicks': sum(ep['hunterBlockedMoveTicks'] for ep in episodes),
            'runners': runners, 'episodes': episodes}
    if protocol in ('hunter-phase1','hunter-pursuit-v2'):
        result.update(phase1_summary(episodes));result.update(trainingProtocol='hunter-pursuit-v2' if protocol=='hunter-pursuit-v2' else 'hunter-capture7-v1',rewardVersion='pursuit-observed-route-v2' if protocol=='hunter-pursuit-v2' else 'capture7-time-motion-v1',hunterSpeedRatio=hunter_speed_ratio,mapPool=map_pool,runnerPolicy='smart-escape-v1' if protocol=='hunter-pursuit-v2' else 'frozen-waypoint-v1',runnerModelSha256='smart-escape-v1' if protocol=='hunter-pursuit-v2' else 'frozen-waypoint-v1',codeHash=os.environ.get('HUNTER_CODE_HASH','direct-script-no-snapshot'))
    result.update(pursuit_config)
    return result


def evaluate(runner_policy=None, hunter_policy=None, seeds=None, max_ticks=2000, verify_determinism=False,protocol='selfplay',hunter_speed_ratio=1.35):
    result = _evaluate_once(runner_policy, hunter_policy, seeds, max_ticks,protocol,hunter_speed_ratio)
    mismatches = 0
    if verify_determinism:
        repeated = _evaluate_once(runner_policy, hunter_policy, seeds, max_ticks,protocol,hunter_speed_ratio)
        mismatches = sum(left != right for left, right in zip(result['episodes'], repeated['episodes']))
    result['determinismVerified'] = bool(verify_determinism and mismatches == 0)
    result['repeatabilityMismatches'] = mismatches
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runner-policy', type=Path)
    parser.add_argument('--hunter-policy', type=Path)
    parser.add_argument('--max-ticks', type=int, default=2000)
    parser.add_argument('--seeds', type=int, nargs='+', default=FIXED_SEEDS)
    parser.add_argument('--output', type=Path, default=Path('evaluation.json'))
    parser.add_argument('--verify-determinism', action='store_true')
    parser.add_argument('--protocol',choices=['selfplay','hunter-phase1','hunter-pursuit-v2'],default='selfplay')
    parser.add_argument('--hunter-speed-ratio',type=float,default=1.35)
    args = vars(parser.parse_args())
    output = args.pop('output')
    result = evaluate(**args)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(f'Evaluated {result["episodeCount"]} full games; saved {output}')

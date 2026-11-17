"""Validate exact fixed-seed evaluation evidence and atomically promote models."""
import argparse, hashlib, json, os, shutil, uuid
from pathlib import Path

MAX_TIMEOUT_RATE = 0.20

def sha256(path: Path): return hashlib.sha256(path.read_bytes()).hexdigest()

def validate_model(path: Path, side: str):
    model=json.loads(path.read_text(encoding='utf-8')); expected=316 if side=='runner' else 313
    if model.get('schemaVersion')!=1 or model.get('observationSize')!=expected or model.get('actionSize')!=18 or not model.get('modelVersion'):
        raise ValueError(f'{side} model does not match browser schema')
    return model

def validate_episode(episode, seed, max_ticks):
    if not isinstance(episode,dict) or episode.get('seed')!=seed: raise ValueError('episode fixed seed does not match evaluation seed order')
    result=episode.get('result')
    if not isinstance(result,dict) or result.get('reason') not in ('last-survivor','all-eliminated','timeout') or result.get('winnerKind') not in ('runner','hunter','none') or not isinstance(result.get('tick'),int) or result['tick']<0 or result['tick']>max_ticks:
        raise ValueError('episode result integrity check failed')
    reason,winner_kind,winner_id=result['reason'],result['winnerKind'],result.get('winnerId')
    valid_outcome=(reason=='last-survivor' and winner_kind=='runner' and winner_id in [f'{i:02d}' for i in range(1,9)]) or (reason=='all-eliminated' and winner_kind=='hunter' and winner_id=='hunter') or (reason=='timeout' and winner_kind=='none' and winner_id is None and result['tick']==max_ticks)
    if not valid_outcome: raise ValueError('episode result winner/reason integrity check failed')
    runners=episode.get('runners'); expected_ids=[f'{i:02d}' for i in range(1,9)]
    if not isinstance(runners,list) or sorted(r.get('id') for r in runners if isinstance(r,dict))!=expected_ids: raise ValueError('episode runner integrity check failed')

def promote(candidate: Path, evaluation_path: Path, destination: Path, expected_episodes: int):
    evaluation=json.loads(evaluation_path.read_text(encoding='utf-8')); expected_seeds=list(range(1,expected_episodes+1)); seeds=evaluation.get('seeds')
    if not isinstance(seeds,list) or len(seeds)!=len(set(seeds)): raise ValueError('evaluation contains duplicate fixed seeds')
    if seeds!=expected_seeds: raise ValueError('evaluation fixed seed set is incomplete or unexpected')
    episodes=evaluation.get('episodes')
    if evaluation.get('episodeCount')!=expected_episodes or not isinstance(episodes,list) or len(episodes)!=expected_episodes: raise ValueError(f'evaluation must contain exactly {expected_episodes} completed episodes')
    if evaluation.get('determinismVerified') is not True or evaluation.get('repeatabilityMismatches')!=0: raise ValueError('evaluation determinism evidence is missing or failed')
    runner_path,hunter_path=candidate/'runner-policy.json',candidate/'hunter-policy.json'; runner,hunter=validate_model(runner_path,'runner'),validate_model(hunter_path,'hunter')
    if evaluation.get('runnerPolicy')!=runner['modelVersion'] or evaluation.get('hunterPolicy')!=hunter['modelVersion']: raise ValueError('evaluation model version is unrelated to candidate')
    runner_hash,hunter_hash=sha256(runner_path),sha256(hunter_path)
    if evaluation.get('runnerModelSha256')!=runner_hash or evaluation.get('hunterModelSha256')!=hunter_hash: raise ValueError('evaluation model hash is stale or unrelated to candidate')
    max_ticks=evaluation.get('maxTicks')
    if not isinstance(max_ticks,int) or max_ticks<=0: raise ValueError('evaluation maxTicks is invalid')
    for seed,episode in zip(expected_seeds,episodes): validate_episode(episode,seed,max_ticks)
    timeout_count=sum(episode['result']['reason']=='timeout' for episode in episodes)
    if evaluation.get('timeouts')!=timeout_count or timeout_count/expected_episodes>MAX_TIMEOUT_RATE: raise ValueError(f'evaluation timeout rate exceeds acceptance limit {MAX_TIMEOUT_RATE:.0%}')
    manifest={'schemaVersion':1,'accepted':True,'acceptanceCriteria':{'fixedSeeds':expected_seeds,'determinismRequired':True,'maxTimeoutRate':MAX_TIMEOUT_RATE},'fixedSeeds':expected_seeds,'evaluationEpisodes':expected_episodes,'timeoutRate':timeout_count/expected_episodes,'runnerModelVersion':runner['modelVersion'],'hunterModelVersion':hunter['modelVersion'],'runnerModelSha256':runner_hash,'hunterModelSha256':hunter_hash}
    destination.parent.mkdir(parents=True,exist_ok=True);stage=destination.parent/f'.{destination.name}.stage-{uuid.uuid4().hex}';backup=destination.parent/f'.{destination.name}.backup-{uuid.uuid4().hex}';stage.mkdir()
    try:
        for name in ('runner-policy.json','hunter-policy.json','metrics.json'): shutil.copyfile(candidate/name,stage/name)
        shutil.copyfile(evaluation_path,stage/'evaluation.json');(stage/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        had_destination=destination.exists()
        if had_destination: os.replace(destination,backup)
        try: os.replace(stage,destination)
        except Exception:
            if had_destination and backup.exists(): os.replace(backup,destination)
            raise
        if backup.exists(): shutil.rmtree(backup)
    finally:
        if stage.exists(): shutil.rmtree(stage)
    return manifest

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--candidate',type=Path,required=True);parser.add_argument('--evaluation',type=Path,required=True);parser.add_argument('--destination',type=Path,required=True);parser.add_argument('--expected-episodes',type=int,default=200);args=parser.parse_args();print(json.dumps(promote(args.candidate,args.evaluation,args.destination,args.expected_episodes),ensure_ascii=False))

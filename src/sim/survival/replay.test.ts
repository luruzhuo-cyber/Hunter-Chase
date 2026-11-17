import { describe, expect, it } from 'vitest';
import { createSurvivalWorld, stepSurvivalWorld, type SurvivalActions } from './world';
import { createSurvivalReplay, parseSurvivalReplay, replaySurvival, resolveReplayPolicies } from '../replay';

const actionsAt = (tick: number): SurvivalActions => Object.fromEntries(
  ['01','02','03','04','05','06','07','08'].map((id,index) => [id,{move:{x:(tick+index)%3-1,y:(tick*2+index)%3-1},useSkill:tick===index+1}])
    .concat([['hunter',{move:{x:1,y:tick%2?1:-1}}] as never]),
);

describe('SurvivalReplayV2', () => {
  const completed = () => {
    let world=createSurvivalWorld({seed:42,maxTicks:4});const frames=[];
    while(world.phase==='running'){const actions=actionsAt(world.tick);frames.push({tick:world.tick,actions});world=stepSurvivalWorld(world,actions)}
    return createSurvivalReplay({mapSeed:42,inferenceSeed:7,runnerPolicy:{selection:'fallback',version:'reward-lookahead-v1'},hunterPolicy:{selection:'fallback',version:'reward-lookahead-v1'},frames,result:world.result!,rewardSummaries:{runner:{total:1},hunter:{total:-1}},finalWorld:world});
  };
  it('stores reproducibility, policy, action, result and reward metadata', () => {
    let world=createSurvivalWorld({seed:1701,maxTicks:8});
    const frames=[];
    for(let tick=0;world.phase==='running';tick++){
      const actions=actionsAt(tick);frames.push({tick:world.tick,actions});world=stepSurvivalWorld(world,actions);
    }
    const replay=createSurvivalReplay({mapSeed:1701,inferenceSeed:991,runnerPolicy:{selection:'model',version:'runner-g4'},hunterPolicy:{selection:'fallback',version:'reward-lookahead-v1'},frames,result:world.result!,rewardSummaries:{runner:{total:12.5},hunter:{total:-3}},finalWorld:world});
    expect(replay).toMatchObject({version:2,mapSeed:1701,inferenceSeed:991,runnerPolicy:{selection:'model',version:'runner-g4'},hunterPolicy:{selection:'fallback'},result:world.result,rewardSummaries:{runner:{total:12.5}}});
    expect(replay.frames).toHaveLength(8);
    expect(replay.finalActors).toHaveLength(9);
  });

  it('replays resolved actions to exactly reproduce poses and winner', () => {
    let world=createSurvivalWorld({seed:42,maxTicks:20});const frames=[];
    while(world.phase==='running') { const actions=actionsAt(world.tick);frames.push({tick:world.tick,actions});world=stepSurvivalWorld(world,actions); }
    const file=createSurvivalReplay({mapSeed:42,inferenceSeed:7,runnerPolicy:{selection:'fallback',version:'reward-lookahead-v1'},hunterPolicy:{selection:'fallback',version:'reward-lookahead-v1'},frames,result:world.result!,rewardSummaries:{},finalWorld:world});
    const restored=replaySurvival(file).world;
    expect(restored.result).toEqual(world.result);
    expect([restored.hunter,...restored.runners].map(a=>a.kinematics)).toEqual([world.hunter,...world.runners].map(a=>a.kinematics));
  });

  it('reports V1 incompatibility in readable Chinese', () => {
    expect(()=>parseSurvivalReplay(JSON.stringify({version:1,seed:1}))).toThrow(/旧版.*不兼容.*V2/);
  });

  it('rejects incompatible models and makes a missing model fallback explicit', () => {
    const base={version:2,mapSeed:1,inferenceSeed:2,dt:.1,maxTicks:1,rulesVersion:'survival-v2',runnerPolicy:{selection:'model',version:'runner-g4',fallbackVersion:'reward-lookahead-v1'},hunterPolicy:{selection:'model',version:'hunter-g4',fallbackVersion:'reward-lookahead-v1'},frames:[],result:{winnerKind:'none',reason:'timeout',tick:0,rankings:[]},rewardSummaries:{},finalActors:[]} as const;
    expect(resolveReplayPolicies(base,{runner:new Map(),hunter:new Map()})).toMatchObject({fallbackDriven:true,runner:{selection:'fallback',version:'reward-lookahead-v1'},hunter:{selection:'fallback',version:'reward-lookahead-v1'}});
    const incompatible={schemaVersion:1,modelVersion:'runner-g4',observationSize:1,actionSize:1,normalization:{mean:[0],std:[1]},layers:[{weights:[[0]],biases:[0],activation:'linear'}]} as const;
    expect(()=>resolveReplayPolicies(base,{runner:new Map([['runner-g4',incompatible]]),hunter:new Map()})).toThrow(/runner-g4.*不兼容/);
  });

  it.each([
    ['non-finite motion', (file:any)=>{file.frames[0].actions['01'].move.x=Infinity}],
    ['out-of-order ticks', (file:any)=>{file.frames[1].tick=9}],
    ['invalid policy metadata', (file:any)=>{file.runnerPolicy.version=''}],
    ['non-finite reward', (file:any)=>{file.rewardSummaries.runner.total=NaN}],
    ['duplicate final actors', (file:any)=>{file.finalActors[1].id='hunter'}],
    ['invalid result', (file:any)=>{file.result.reason='mystery'}],
    ['duplicate ranking actors', (file:any)=>{file.result.rankings[1].id=file.result.rankings[0].id}],
  ])('deeply rejects %s', (_name, mutate) => {
    const file=completed();mutate(file);
    expect(()=>parseSurvivalReplay(JSON.stringify(file))).toThrow(/V2.*(动作|策略|奖励|角色|赛果|损坏)/);
  });

  it('rejects a replay whose reproduced result or final pose does not match metadata', () => {
    const wrongResult=completed();wrongResult.result.tick++;
    expect(()=>replaySurvival(wrongResult)).toThrow(/回放校验失败.*赛果/);
    const wrongPose=completed();wrongPose.finalActors[0]!.kinematics.position.x+=.01;
    expect(()=>replaySurvival(wrongPose)).toThrow(/回放校验失败.*姿态/);
  });
});

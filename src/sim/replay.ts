import {createWorld,getResult,stepWorld} from './simulation';
import type {ReplayFileV1,WorldState} from './types';
import { validatePolicyModel, HUNTER_OBSERVATION_SIZE, POLICY_ACTION_COUNT, RUNNER_OBSERVATION_SIZE } from '../ai/model-format';
import type { PolicyModelV1 } from '../ai/model-format';
import { createSurvivalWorld, stepSurvivalWorld } from './survival/world';
import type { SurvivalActions, SurvivalResult, SurvivalWorld } from './survival/world';
export function exportReplay(w:WorldState):ReplayFileV1{return {version:1,seed:w.seed,config:{tickMs:250},map:w.map,events:w.events,result:getResult(w)};}
export function replayToTick(file:ReplayFileV1,tick:number){let w=createWorld(file.seed);while(w.tick<tick&&w.phase!=='finished')w=stepWorld(w).state;return w;}
export function parseReplay(text:string):ReplayFileV1{const f=JSON.parse(text) as ReplayFileV1;if(f.version!==1||typeof f.seed!=='number'||!Array.isArray(f.events)||!f.result||typeof f.result.durationSeconds!=='number'||!f.map)throw new Error('不支持或已损坏的回放文件');return f;}

export type ReplayPolicySelection = {
  selection: 'model' | 'fallback';
  version: string;
  fallbackVersion?: string;
};
export type SurvivalReplayFrame = { tick: number; actions: SurvivalActions };
export type SurvivalReplayV2 = {
  version: 2;
  rulesVersion: 'survival-v2';
  mapSeed: number;
  inferenceSeed: number;
  dt: number;
  maxTicks: number;
  runnerPolicy: ReplayPolicySelection;
  hunterPolicy: ReplayPolicySelection;
  frames: SurvivalReplayFrame[];
  result: SurvivalResult;
  rewardSummaries: Record<string, Record<string, number>>;
  finalActors: Array<{ id: string; active: boolean; kinematics: SurvivalWorld['hunter']['kinematics'] }>;
};

type CreateSurvivalReplayInput = Omit<SurvivalReplayV2, 'version' | 'rulesVersion' | 'dt' | 'maxTicks' | 'finalActors'> & { finalWorld: SurvivalWorld };

export function createSurvivalReplay(input: CreateSurvivalReplayInput): SurvivalReplayV2 {
  return {
    version: 2,
    rulesVersion: 'survival-v2',
    mapSeed: input.mapSeed,
    inferenceSeed: input.inferenceSeed,
    dt: input.finalWorld.dt,
    maxTicks: input.finalWorld.maxTicks,
    runnerPolicy: structuredClone(input.runnerPolicy),
    hunterPolicy: structuredClone(input.hunterPolicy),
    frames: structuredClone(input.frames),
    result: structuredClone(input.result),
    rewardSummaries: structuredClone(input.rewardSummaries),
    finalActors: [input.finalWorld.hunter, ...input.finalWorld.runners].map(actor => ({
      id: actor.id,
      active: actor.active,
      kinematics: structuredClone(actor.kinematics),
    })),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const vector = (value: unknown) => isRecord(value) && finite(value.x) && finite(value.y);
const policy = (value: unknown): value is ReplayPolicySelection => isRecord(value)
  && (value.selection === 'model' || value.selection === 'fallback') && nonempty(value.version)
  && (value.fallbackVersion === undefined || nonempty(value.fallbackVersion));
const action = (value: unknown): boolean => isRecord(value)
  && (value.move === undefined || vector(value.move))
  && (value.desiredHeading === undefined || finite(value.desiredHeading))
  && (value.skillTarget === undefined || vector(value.skillTarget))
  && (value.useSkill === undefined || typeof value.useSkill === 'boolean')
  && (value.interact === undefined || nonempty(value.interact))
  && Object.keys(value).every(key => ['move','desiredHeading','skillTarget','useSkill','interact'].includes(key));
const result = (value: unknown): value is SurvivalResult => {
  if (!isRecord(value) || !integer(value.tick) || !Array.isArray(value.rankings) || value.rankings.length !== 8) return false;
  const ids=value.rankings.map(rank=>isRecord(rank)?rank.id:undefined),expected=['01','02','03','04','05','06','07','08'];
  if ([...ids].sort().join('|')!==expected.join('|') || !value.rankings.every(rank => isRecord(rank) && nonempty(rank.id)
    && finite(rank.survivalSeconds) && rank.survivalSeconds >= 0 && finite(rank.exposure) && rank.exposure >= 0
    && typeof rank.insideZone === 'boolean')) return false;
  return value.reason==='last-survivor'&&value.winnerKind==='runner'&&expected.includes(String(value.winnerId))
    || value.reason==='all-eliminated'&&value.winnerKind==='hunter'&&value.winnerId==='hunter'
    || value.reason==='timeout'&&value.winnerKind==='none'&&value.winnerId===undefined;
};
const finalActor = (value: unknown) => isRecord(value) && nonempty(value.id) && typeof value.active === 'boolean'
  && isRecord(value.kinematics) && vector(value.kinematics.position) && vector(value.kinematics.velocity) && finite(value.kinematics.heading);

export function parseSurvivalReplay(text: string): SurvivalReplayV2 {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('回放文件不是有效的 JSON'); }
  if (isRecord(value) && value.version === 1) throw new Error('旧版回放与生存模式不兼容，请使用 V2 回放文件');
  if (!isRecord(value) || value.version !== 2 || value.rulesVersion !== 'survival-v2'
    || !integer(value.mapSeed) || !integer(value.inferenceSeed)
    || !finite(value.dt) || value.dt <= 0 || !integer(value.maxTicks) || value.maxTicks <= 0
    || !Array.isArray(value.frames) || !result(value.result) || !Array.isArray(value.finalActors)) {
    throw new Error('V2 生存回放文件不支持或已损坏');
  }
  if (!policy(value.runnerPolicy) || !policy(value.hunterPolicy)) throw new Error('V2 策略元数据损坏');
  if (!value.frames.every((frame, index) => isRecord(frame) && frame.tick === index && isRecord(frame.actions)
    && Object.entries(frame.actions).every(([id, intent]) => nonempty(id) && action(intent)))) throw new Error('V2 动作序列损坏');
  if (value.result.tick !== value.frames.length || value.frames.length > value.maxTicks) throw new Error('V2 动作 tick 与赛果不一致');
  if (!isRecord(value.rewardSummaries) || !Object.values(value.rewardSummaries).every(summary => isRecord(summary)
    && Object.values(summary).every(finite))) throw new Error('V2 奖励摘要损坏');
  const expectedIds = ['hunter','01','02','03','04','05','06','07','08'];
  if (value.finalActors.length !== expectedIds.length || !value.finalActors.every(finalActor)
    || [...value.finalActors.map(actor => actor.id)].sort().join('|') !== [...expectedIds].sort().join('|')) throw new Error('V2 最终角色元数据损坏');
  return value as unknown as SurvivalReplayV2;
}

export function replaySurvival(file: SurvivalReplayV2, throughTick = Number.POSITIVE_INFINITY): { world: SurvivalWorld } {
  let world = createSurvivalWorld({ seed: file.mapSeed, dt: file.dt, maxTicks: file.maxTicks });
  for (const frame of file.frames) {
    if (frame.tick >= throughTick || world.phase === 'finished') break;
    if (frame.tick !== world.tick) throw new Error(`回放动作序列不连续：需要 tick ${world.tick}，实际为 ${frame.tick}`);
    world = stepSurvivalWorld(world, frame.actions);
  }
  if (throughTick >= file.frames.length) {
    if (JSON.stringify(world.result) !== JSON.stringify(file.result)) throw new Error('回放校验失败：重现赛果与文件元数据不一致');
    const actual = [world.hunter, ...world.runners].map(actor => ({ id: actor.id, active: actor.active, kinematics: actor.kinematics }));
    if (JSON.stringify(actual) !== JSON.stringify(file.finalActors)) throw new Error('回放校验失败：重现最终姿态与文件元数据不一致');
  }
  return { world };
}

type ReplayModelRegistry = { runner: Map<string, unknown>; hunter: Map<string, unknown> };
export function resolveReplayPolicies(file: Pick<SurvivalReplayV2, 'runnerPolicy' | 'hunterPolicy'>, models: ReplayModelRegistry) {
  let fallbackDriven = false;
  const resolve = (side: 'runner' | 'hunter', selection: ReplayPolicySelection): ReplayPolicySelection & { model?: PolicyModelV1 } => {
    if (selection.selection === 'fallback') return { ...selection };
    const model = models[side].get(selection.version);
    if (model === undefined) {
      fallbackDriven = true;
      return { selection: 'fallback', version: selection.fallbackVersion ?? 'reward-lookahead-v1' };
    }
    try {
      return { ...selection, model: validatePolicyModel(model, { observationSize: side === 'runner' ? RUNNER_OBSERVATION_SIZE : HUNTER_OBSERVATION_SIZE, actionSize: POLICY_ACTION_COUNT }) };
    } catch {
      throw new Error(`模型 ${selection.version} 与当前 ${side} 回放契约不兼容`);
    }
  };
  const runner = resolve('runner', file.runnerPolicy), hunter = resolve('hunter', file.hunterPolicy);
  return { fallbackDriven, runner, hunter };
}

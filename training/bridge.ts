/** Persistent JSON-lines transport. All game rules remain in the browser's TS engine. */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createSurvivalWorld, stepSurvivalWorld } from '../src/sim/survival/world';
import type { SurvivalWorld, SurvivalActions } from '../src/sim/survival/world';
import { buildHunterObservation, buildRunnerObservation } from '../src/sim/survival/observation';
import type { RunnerObservationMemory, RunnerObservation, HunterObservation } from '../src/sim/survival/observation';
import { skillObservationModifiers } from '../src/sim/survival/skills';
import { scoreHunterTransition, scoreRunnerTransition } from '../src/sim/survival/reward';
import { buildLegalActionMask, decodePolicyAction, decideFromObservation } from '../src/ai/fallback-policy';
import { encodeRunnerObservation, encodeHunterObservation, validatePolicyModel,
  RUNNER_OBSERVATION_SIZE, HUNTER_OBSERVATION_SIZE, POLICY_ACTION_COUNT,
  OBSERVATION_SCHEMA_VERSION, ACTION_SCHEMA_VERSION, POLICY_ACTIONS } from '../src/ai/model-format';
import type { PolicyModelV1 } from '../src/ai/model-format';
import { runPolicy } from '../src/ai/mlp';
import { Rng } from '../src/sim/rng';
import { createPhase1, randomRunnerActions, scorePhase1, movementWindow, poolManifest, PHASE1_VERSION, REWARD_VERSION, RUNNER_VERSION } from './phase1';
import type { RouteState, MotionSample } from './phase1';
import {createPursuitWorld,createPursuitState,updatePursuit,decideRunnerActions,buildPursuitObservation,SPAWN_POLICY_VERSION,SPAWN_PATH_MIN,SPAWN_PATH_MAX} from '../src/sim/pursuit';
import {encodePursuitObservation,PURSUIT_OBSERVATION_SIZE,pursuitPotential} from '../src/ai/pursuit-model';
import {loadPoolMap} from './phase1';

export const CONTRACT = { protocolVersion: 1, observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
  actionSchemaVersion: ACTION_SCHEMA_VERSION, runnerObservationSize: RUNNER_OBSERVATION_SIZE,
  hunterObservationSize: HUNTER_OBSERVATION_SIZE, actionSize: POLICY_ACTION_COUNT, actions: POLICY_ACTIONS };

export class TrainingSession {
  world!: SurvivalWorld;
  pursuit=createPursuitState(1);
  isCaptureProtocol(){return this.protocol==='hunter-phase1'||this.protocol==='hunter-pursuit-v2'}
  protocolMetadata(){return {trainingProtocol:this.protocol==='hunter-pursuit-v2'?'hunter-pursuit-v2':PHASE1_VERSION,rewardVersion:this.protocol==='hunter-pursuit-v2'?'pursuit-observed-route-v2':REWARD_VERSION,runnerPolicy:this.protocol==='hunter-pursuit-v2'?'smart-escape-v1':RUNNER_VERSION,...(this.protocol==='hunter-pursuit-v2'?{spawnPolicy:SPAWN_POLICY_VERSION,spawnPathRange:[SPAWN_PATH_MIN,SPAWN_PATH_MAX]}:{})}}
  side: 'runner' | 'hunter' = 'runner';
  actorId = '01';
  rng = new Rng(1);
  memories: Record<string, RunnerObservationMemory> = {};
  observations: Record<string, RunnerObservation | HunterObservation> = {};
  opponent?: PolicyModelV1;
  teammate?: PolicyModelV1;
  mapHash = '';
  done = true;
  gamma = .99;
  skillTicks: Record<string, number> = {};
  blockedTicks: Record<string, number> = {};
  discoveryCount = 0;
  lostTargetCount = 0;
  protocol='selfplay'; mapId=''; hunterSpeedRatio=1.35; routes:RouteState={}; motionSamples:MotionSample[]=[];
  motion={effectiveWindows:0,idleWindows:0,spinningWindows:0,totalWindows:0,blockedTicks:0};firstCaptureTick:number|null=null;

  observe() {
    const world = this.world;
    this.observations.hunter = buildHunterObservation(world, world.perception, skillObservationModifiers(world, world.hunter));
    for (const runner of world.runners) {
      const obs = buildRunnerObservation(world, runner.id, this.memories[runner.id], skillObservationModifiers(world, runner));
      this.memories[runner.id] = { lastSeenHunter: obs.lastSeenHunter };
      this.observations[runner.id] = obs;
    }
  }
  encoded(id: string) {
    if(id==='hunter'&&this.protocol==='hunter-pursuit-v2')return encodePursuitObservation(this.observations.hunter as HunterObservation,buildPursuitObservation(this.world,this.pursuit),this.world.dt);
    return id === 'hunter' ? encodeHunterObservation(this.observations[id] as HunterObservation)
      : encodeRunnerObservation(this.observations[id] as RunnerObservation);
  }
  response(extra: Record<string, unknown> = {}) {
    return { observation: this.encoded(this.actorId), mask: buildLegalActionMask(this.observations[this.actorId]!, this.side, this.world.dt),
      info: { tick: this.world.tick, actor_id: this.actorId, map_hash: this.mapHash, result: this.world.result ?? null,...(this.protocol==='hunter-pursuit-v2'?{pursuit:buildPursuitObservation(this.world,this.pursuit)}:{}), ...extra } };
  }
  request(request: any): any {
    if (request.op === 'contract') return request.protocol==='hunter-pursuit-v2'?{...CONTRACT,observationSchemaVersion:2,hunterObservationSize:PURSUIT_OBSERVATION_SIZE}:CONTRACT;
    if (request.op === 'maps') return poolManifest();
    if (request.op === 'pursuit-config') return {spawnPolicy:SPAWN_POLICY_VERSION,spawnPathRange:[SPAWN_PATH_MIN,SPAWN_PATH_MAX]};
    if (request.op === 'logits') {
      const model = validatePolicyModel(request.model);
      return request.observations.map((obs: number[]) => runPolicy(model, obs, new Rng(1)).logits);
    }
    if (request.op === 'reset') {
      if (!['runner', 'hunter'].includes(request.side)) throw new Error('invalid side');
      this.protocol=request.protocol??'selfplay';
      if(!['selfplay','hunter-phase1','hunter-pursuit-v2'].includes(this.protocol))throw new Error('unknown training protocol');
      if(this.isCaptureProtocol()&&request.side!=='hunter')throw new Error('phase1 trains hunter only');
      if(this.isCaptureProtocol()){
        if(!['train','evaluation'].includes(request.seedDomain??'train'))throw new Error('invalid phase1 seed domain');
        const offset=request.seedDomain==='evaluation'?1_000_000_000:0;
        if(!Number.isInteger(request.seed)||request.seed<offset||request.seed>=offset+1_000_000_000)throw new Error('phase1 route seed outside declared domain');
      }
      this.mapId=request.mapId??'01';this.hunterSpeedRatio=request.hunterSpeedRatio??1.35;
      this.world = this.protocol==='hunter-pursuit-v2'?createPursuitWorld(loadPoolMap(this.mapId),request.seed,this.hunterSpeedRatio,request.maxTicks):this.isCaptureProtocol()?createPhase1(this.mapId,request.seed,request.maxTicks,this.hunterSpeedRatio):createSurvivalWorld({ seed: request.seed, maxTicks: request.maxTicks });
      this.pursuit=createPursuitState(request.seed);if(this.protocol==='hunter-pursuit-v2')updatePursuit(this.world,this.pursuit);
      this.routes={};this.motionSamples=[{tick:0,position:{...this.world.hunter.kinematics.position}}];this.firstCaptureTick=null;
      this.motion={effectiveWindows:0,idleWindows:0,spinningWindows:0,totalWindows:0,blockedTicks:0};
      this.side = request.side;
      this.actorId = this.side === 'hunter' ? 'hunter' : this.world.runners[request.runnerIndex ?? 0]!.id;
      this.gamma = request.gamma ?? .99;
      this.rng = new Rng(request.seed);
      this.memories = {}; this.observations = {}; this.skillTicks = {}; this.done = false;
      this.blockedTicks = {}; this.discoveryCount = 0; this.lostTargetCount = 0;
      const load = (path: string | undefined, role: 'runner' | 'hunter') => path ? validatePolicyModel(JSON.parse(readFileSync(path, 'utf8')),
        { observationSize: role === 'runner' ? RUNNER_OBSERVATION_SIZE : HUNTER_OBSERVATION_SIZE, actionSize: POLICY_ACTION_COUNT }) : undefined;
      this.opponent = load(request.opponent, this.side === 'runner' ? 'hunter' : 'runner');
      this.teammate = load(request.teammate, 'runner');
      this.mapHash = this.isCaptureProtocol()?poolManifest().find(m=>m.id===this.mapId)!.sha256:createHash('sha256').update(JSON.stringify(this.world.map)).digest('hex');
      this.observe();
      return this.response(this.isCaptureProtocol()?{mapId:this.mapId,routeSeed:this.world.seed,seedDomain:request.seedDomain??'train',...this.protocolMetadata(),hunterSpeedRatio:this.hunterSpeedRatio}:{});
    }
    if (request.op !== 'step') throw new Error('unknown bridge operation');
    if (this.done) throw new Error('episode ended; reset required');
    const mask = buildLegalActionMask(this.observations[this.actorId]!, this.side, this.world.dt);
    if (!Number.isInteger(request.action) || !mask[request.action]) throw new Error('illegal action');
    const previous = this.world, previousObservation = this.observations[this.actorId]!;
    const previousPursuit=this.protocol==='hunter-pursuit-v2'?buildPursuitObservation(previous,this.pursuit):undefined;
    const actions: SurvivalActions = this.protocol==='hunter-pursuit-v2'?decideRunnerActions(previous,this.pursuit):this.isCaptureProtocol()?randomRunnerActions(previous,this.routes):{};
    for (const actor of [previous.hunter, ...previous.runners.filter(r => r.active)]) {
      const observation = this.observations[actor.id]!;
      if (actor.id === this.actorId) actions[actor.id] = decodePolicyAction(request.action, observation, actor.kind, previous.dt);
      else if(!this.isCaptureProtocol()) {
        const model = actor.kind !== this.side ? this.opponent : this.teammate;
        actions[actor.id] = model ? decodePolicyAction(runPolicy(model, this.encoded(actor.id), this.rng,
          buildLegalActionMask(observation, actor.kind, previous.dt)).actionIndex, observation, actor.kind, previous.dt)
          : decideFromObservation(observation, actor.kind, previous.dt, this.rng);
      }
    }
    const previousVisible = new Set(this.protocol==='hunter-pursuit-v2'?Object.keys(this.pursuit.seenSince):(this.observations.hunter as HunterObservation).visibleRunners.map(actor => actor.id));
    this.world = stepSurvivalWorld(previous, actions);
    if(this.protocol==='hunter-pursuit-v2')updatePursuit(this.world,this.pursuit);
    let motionPenalty=0;
    if(this.isCaptureProtocol()){
      this.motionSamples.push({tick:this.world.tick,position:{...this.world.hunter.kinematics.position}});
      if(this.world.tick%Math.round(1/this.world.dt)===0){const m=movementWindow(this.motionSamples,this.world.dt);if(m.ready){this.motion.totalWindows++;if(m.idle)this.motion.idleWindows++;else if(m.spinning)this.motion.spinningWindows++;else this.motion.effectiveWindows++;if(m.ineffective)motionPenalty=.1}}
      this.motionSamples=this.motionSamples.filter(s=>(this.world.tick-s.tick)*this.world.dt<=1+1e-8);
      if(this.firstCaptureTick===null&&this.world.runners.some(r=>!r.active))this.firstCaptureTick=this.world.tick;
    }
    this.observe();
    const nextVisible = new Set(this.protocol==='hunter-pursuit-v2'?Object.keys(this.pursuit.seenSince):(this.observations.hunter as HunterObservation).visibleRunners.map(actor => actor.id));
    this.discoveryCount += [...nextVisible].filter(id => !previousVisible.has(id)).length;
    this.lostTargetCount += [...previousVisible].filter(id => !nextVisible.has(id) && this.world.runners.find(r => r.id === id)?.active).length;
    for (const before of [previous.hunter, ...previous.runners]) {
      const move = actions[before.id]?.move;
      const after = before.id === 'hunter' ? this.world.hunter : this.world.runners.find(r => r.id === before.id)!;
      if (before.active && after.active && move && Math.hypot(move.x, move.y) > 0
        && Math.hypot(after.kinematics.position.x - before.kinematics.position.x, after.kinematics.position.y - before.kinematics.position.y) < 1e-6)
        this.blockedTicks[before.id] = (this.blockedTicks[before.id] ?? 0) + 1;
    }
    for (const event of this.world.skillEvents) this.skillTicks[event.actorId] ??= event.tick;
    const nextObservation = this.observations[this.actorId]!;
    const context = { gamma: this.gamma, events: this.world.skillEvents };
    const baseReward = this.side === 'hunter' ? scoreHunterTransition(previous, this.world, { ...context,
      hunterPrevious: previousObservation as HunterObservation, hunterNext: nextObservation as HunterObservation })
      : scoreRunnerTransition(previous, this.world, this.actorId, { ...context,
        runnerPrevious: previousObservation as RunnerObservation, runnerNext: nextObservation as RunnerObservation });
    const reward=this.isCaptureProtocol()?scorePhase1(previous,this.world,motionPenalty):baseReward;
    if(this.isCaptureProtocol()){reward.shaping=this.protocol==='hunter-pursuit-v2'?this.gamma*pursuitPotential(buildPursuitObservation(this.world,this.pursuit),this.world.phase==='finished')-pursuitPotential(previousPursuit!):baseReward.shaping;reward.total+=reward.shaping}
    const actorEliminated = this.side === 'runner' && !this.world.runners.find(r => r.id === this.actorId)!.active;
    // Individual runner MDP ends at elimination; it must never bootstrap through its death.
    const terminated = actorEliminated || this.world.phase === 'finished' && this.world.result?.reason !== 'timeout';
    const truncated = !terminated && this.world.result?.reason === 'timeout';
    this.done = terminated || truncated;
    return { ...this.response({ reward_breakdown: reward,
      ...(this.done ? { episode_stats: { seed: this.world.seed, result: this.world.result ?? { reason: 'controlled-eliminated', winnerKind: 'none' },
        discoveryCount: this.discoveryCount, lostTargetCount: this.lostTargetCount, hunterBlockedMoveTicks: this.blockedTicks.hunter ?? 0,
        ...(this.isCaptureProtocol()?{mapId:this.mapId,mapHash:this.mapHash,...this.protocolMetadata(),hunterSpeedRatio:this.hunterSpeedRatio,
          captureCount:this.world.runners.filter(r=>!r.active&&r.eliminationReason==='capture').length,capture7Complete:this.world.runners.filter(r=>!r.active&&r.eliminationReason==='capture').length>=7,
          firstCaptureSeconds:this.firstCaptureTick===null?null:this.firstCaptureTick*this.world.dt,capture7Seconds:this.world.runners.filter(r=>!r.active&&r.eliminationReason==='capture').length>=7?this.world.tick*this.world.dt:null,
          motion:{...this.motion,blockedTicks:this.blockedTicks.hunter??0}}:{}),
        runners: this.world.runners.map(r => ({ id: r.id, survivalSeconds: r.survivalSeconds, active: r.active,
          blockedMoveTicks: this.blockedTicks[r.id] ?? 0,
          eliminationReason: r.eliminationReason ?? null, skillUsed: r.skillUsed, skillTick: this.skillTicks[r.id] ?? null,
          postSkillSurvivalSeconds: this.skillTicks[r.id] === undefined ? null : Math.max(0, r.survivalSeconds - this.skillTicks[r.id]! * this.world.dt) })) } } : {}) }),
      reward: reward.total, terminated, truncated };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const session = new TrainingSession();
  createInterface({ input: process.stdin }).on('line', line => {
    try { process.stdout.write(JSON.stringify({ ok: true, data: session.request(JSON.parse(line)) }) + '\n'); }
    catch (error) { process.stdout.write(JSON.stringify({ ok: false, error: String(error) }) + '\n'); }
  });
}

import { generateSurvivalMap, sampleTerrain, validateSurvivalMap } from './map';
import { integrateMotion } from './motion';
import { advanceHunterPerception, canHunterSee, hasLineOfSight, turnHunter } from './observation';
import { createSkillState, hunterSkillAttention, resolveWorldSkills, skillSpeedMultiplier } from './skills';
import type { SurvivalPerceptionState } from './observation';
import type { SkillEvent, SurvivalSkillState } from './skills';
import { isTraversable, positionCell } from './pathing';
import { createZoneSchedule, isInsideZone, zoneAtTick } from './zone';
import type { SurvivalMap } from './map';
import type { MotionControl } from './motion';
import type { KinematicState, SkillId, SurvivalActor, Vec2 } from './types';
import type { ZoneSchedule, ZoneState } from './zone';

export type EliminationReason = 'capture' | 'exposure';
export type SurvivalWorldActor = SurvivalActor & { exposure: number; survivalSeconds: number; eliminatedAt?: number; eliminationReason?: EliminationReason };
export type SurvivalAction = Partial<MotionControl> & { interact?: string; useSkill?: boolean; skillTarget?: Vec2 };
export type SurvivalActions = Record<string, SurvivalAction>;
export type SurvivalRanking = { id: string; survivalSeconds: number; exposure: number; insideZone: boolean };
export type SurvivalResult = {
  winnerKind: 'runner' | 'hunter' | 'none'; winnerId?: string;
  reason: 'last-survivor' | 'all-eliminated' | 'timeout'; tick: number; rankings: SurvivalRanking[];
};
export type SurvivalEvent = { tick: number; type: 'elimination' | 'finished'; actorId?: string; reason: string };
/** Extension work runs only in its fixed slots; core elimination and terminal ordering stay here. */
export type SurvivalRules = {
  resolveSkills?: (world: SurvivalWorld, actions: SurvivalActions) => void;
  updatePerception?: (world: SurvivalWorld, actions: SurvivalActions) => void;
  canCapture?: (world: SurvivalWorld, runner: SurvivalWorldActor) => boolean;
};
export type SurvivalWorldConfig = {
  seed: number; map?: SurvivalMap; dt?: number; maxTicks?: number; captureRadius?: number; zoneSchedule?: ZoneSchedule; rules?: SurvivalRules; hunterSpeedMultiplier?: number; skillsDisabled?: boolean; stopAtOne?: boolean;
};
export type SurvivalWorld = {
  seed: number; tick: number; dt: number; maxTicks: number; captureRadius: number; phase: 'running' | 'finished';
  map: SurvivalMap; runners: SurvivalWorldActor[]; hunter: SurvivalWorldActor; zoneSchedule: ZoneSchedule; zone: ZoneState;
  events: SurvivalEvent[]; skillEvents: SkillEvent[]; skills: SurvivalSkillState; perception?: SurvivalPerceptionState; result?: SurvivalResult; rules?: SurvivalRules;
  hunterSpeedMultiplier?: number; skillsDisabled?: boolean; stopAtOne?: boolean;
};

const SKILLS: SkillId[] = ['beacon', 'silent-step', 'wall-phase', 'door-override', 'sound-projection', 'adrenaline', 'scout', 'danger-sense'];
const finiteVector = (vector: Vec2): boolean => Number.isFinite(vector.x) && Number.isFinite(vector.y);

export function createSurvivalWorld(config: SurvivalWorldConfig): SurvivalWorld {
  if(config.hunterSpeedMultiplier!==undefined&&(!Number.isFinite(config.hunterSpeedMultiplier)||config.hunterSpeedMultiplier<.5||config.hunterSpeedMultiplier>3))throw new Error('invalid hunter speed multiplier');
  const dt = config.dt ?? 0.1, maxTicks = config.maxTicks ?? Math.ceil(200 / dt), captureRadius = config.captureRadius ?? 0.65;
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isInteger(maxTicks) || maxTicks <= 0 || !Number.isFinite(captureRadius) || captureRadius < 0) throw new Error('invalid survival timing or capture radius');
  const map = structuredClone(config.map ?? generateSurvivalMap(config.seed));
  const validation = validateSurvivalMap(map);
  if (!validation.valid) throw new Error(`invalid survival map: ${validation.errors.join(', ')}`);
  const zoneSchedule = structuredClone(config.zoneSchedule ?? createZoneSchedule(map, { dt }));
  if (zoneSchedule.dt !== dt) throw new Error('zone schedule dt must match world dt');
  const actor = (id: string, kind: SurvivalActor['kind'], position: Vec2, skill?: SkillId): SurvivalWorldActor => ({
    id, kind, kinematics: { position: { ...position }, velocity: { x: 0, y: 0 }, heading: 0 }, skill, skillUsed: false, active: true, exposure: 0, survivalSeconds: 0,
  });
  return { seed: config.seed, tick: 0, dt, maxTicks, captureRadius, phase: 'running', map,
    ...(config.hunterSpeedMultiplier!==undefined?{hunterSpeedMultiplier:config.hunterSpeedMultiplier}:{}),...(config.skillsDisabled?{skillsDisabled:true}:{}),...(config.stopAtOne?{stopAtOne:true}:{}),
    runners: map.runnerSpawns.map((position, index) => actor(String(index + 1).padStart(2, '0'), 'runner', position, SKILLS[index])),
    hunter: actor('hunter', 'hunter', map.hunterSpawn), zoneSchedule, zone: zoneAtTick(zoneSchedule, 0), events: [], skillEvents: [], skills: createSkillState(), rules: config.rules };
}

/** Supercover grid traversal includes both neighbours at an exact corner, preventing corner cuts. */
function crossedCells(map: SurvivalMap, from: Vec2, to: Vec2): number[] {
  const start = positionCell(map, from), end = positionCell(map, to);
  if (start < 0 || end < 0) return [-1];
  const cells = [start];
  let x = Math.floor(from.x), y = Math.floor(from.y);
  const endX = Math.floor(to.x), endY = Math.floor(to.y);
  const dx = to.x - from.x, dy = to.y - from.y, sx = Math.sign(dx), sy = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx), deltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
  let tx = dx === 0 ? Infinity : ((sx > 0 ? x + 1 : x) - from.x) / dx;
  let ty = dy === 0 ? Infinity : ((sy > 0 ? y + 1 : y) - from.y) / dy;
  while (x !== endX || y !== endY) {
    // A negative axis can touch an endpoint boundary without entering the cell beyond it.
    const nextX = x === endX ? Infinity : tx, nextY = y === endY ? Infinity : ty;
    if (Math.abs(nextX - nextY) < 1e-12) {
      cells.push(y * map.width + x + sx, (y + sy) * map.width + x);
      x += sx; y += sy; tx += deltaX; ty += deltaY;
    } else if (nextX < nextY) { x += sx; tx += deltaX; }
    else { y += sy; ty += deltaY; }
    cells.push(y * map.width + x);
  }
  return cells;
}

function stopAt(state: KinematicState, proposed: KinematicState): KinematicState {
  return { position: { ...state.position }, velocity: { x: 0, y: 0 }, heading: proposed.heading };
}

function eliminate(world: SurvivalWorld, runner: SurvivalWorldActor, reason: EliminationReason): void {
  runner.active = false;
  runner.eliminatedAt = world.tick;
  runner.eliminationReason = reason;
  runner.kinematics.velocity = { x: 0, y: 0 };
  world.events.push({ tick: world.tick, type: 'elimination', actorId: runner.id, reason });
}

function settleResult(world: SurvivalWorld): void {
  const active = world.runners.filter(runner => runner.active);
  if (active.length > 1 && world.tick < world.maxTicks) return;
  const rankings = world.runners.map(runner => ({ id: runner.id, survivalSeconds: runner.survivalSeconds, exposure: runner.exposure, insideZone: isInsideZone(runner.kinematics.position, world.zone) }))
    .sort((a, b) => b.survivalSeconds - a.survivalSeconds || a.exposure - b.exposure || Number(b.insideZone) - Number(a.insideZone) || a.id.localeCompare(b.id));
  const reason = active.length === 1 ? 'last-survivor' : active.length === 0 ? 'all-eliminated' : 'timeout';
  world.result = { winnerKind: active.length === 1 ? 'runner' : active.length === 0 ? 'hunter' : 'none', reason, tick: world.tick, rankings,
    ...(active.length === 1 ? { winnerId: active[0]!.id } : active.length === 0 ? { winnerId: world.hunter.id } : {}) };
  world.phase = 'finished';
  world.events.push({ tick: world.tick, type: 'finished', reason });
}

export function stepSurvivalWorld(world: SurvivalWorld, actions: SurvivalActions): SurvivalWorld {
  // Callbacks are functions; clone serializable simulation data independently of these references.
  const { rules, ...state } = world;
  const next: SurvivalWorld = { ...structuredClone(state), rules };
  if (next.phase === 'finished') return next;
  // A restored or externally supplied terminal state must not simulate another tick.
  if (next.runners.filter(runner => runner.active).length <= 1) {
    settleResult(next);
    return next;
  }
  next.tick++;
  next.zone = zoneAtTick(next.zoneSchedule, next.tick);
  const actors = [...next.runners.filter(runner => runner.active), next.hunter];
  const chasing = world.perception?.seed === world.seed && world.perception.tick === world.tick
    && next.runners.some(runner => runner.active && world.perception?.recognition[runner.id]?.recognized
    && canHunterSee(world.hunter, runner.kinematics.position, next.map, next.tick));
  // Integrate [world.tick, next.tick] using effects active at its source endpoint.
  // A skill created after movement at tick c therefore affects exactly N future integrations.
  const attention = hunterSkillAttention(world, chasing);
  let investigationWaypoint: Vec2 | undefined;
  if (attention.investigationTarget) {
    const map = { ...next.map, terrain: [...next.map.terrain] };
    for (const door of map.doors) if (door.lockedUntil > next.tick) map.terrain[positionCell(map, door.position)] = 'wall';
    const backwardDoor = (from: Vec2, to: Vec2) => {
      const cells = crossedCells(map, from, to);
      return map.doors.find(door => door.kind === 'oneway' && cells.includes(positionCell(map, door.position))
        && (to.x - from.x) * door.direction.x + (to.y - from.y) * door.direction.y < 0);
    };
    // Directed cell search follows the same source/destination door rule as movement.
    const start = positionCell(map, next.hunter.kinematics.position), goal = positionCell(map, attention.investigationTarget);
    const parents = new Int32Array(map.terrain.length).fill(-1), queue: number[] = [];
    if (isTraversable(map, start, 'hunter')) { parents[start] = start; queue.push(start); }
    const centre = (cell: number): Vec2 => ({ x: cell % map.width + .5, y: Math.floor(cell / map.width) + .5 });
    for (let head = 0; head < queue.length && parents[goal] === -1; head++) {
      const cell = queue[head]!, x = cell % map.width, y = Math.floor(cell / map.width);
      for (const candidate of [x > 0 ? cell - 1 : -1, x < map.width - 1 ? cell + 1 : -1,
        y > 0 ? cell - map.width : -1, y < map.height - 1 ? cell + map.width : -1]) {
        if (!isTraversable(map, candidate, 'hunter') || parents[candidate] !== -1 || backwardDoor(centre(cell), centre(candidate))) continue;
        parents[candidate] = cell;
        queue.push(candidate);
      }
    }
    const path: Vec2[] = [];
    if (parents[goal] !== undefined && parents[goal] !== -1) {
      for (let cell = goal; cell !== start; cell = parents[cell]!) path.push(centre(cell));
      path.push(centre(start), { ...next.hunter.kinematics.position });
      path.reverse();
      path.push({ ...attention.investigationTarget });
    }
    investigationWaypoint = path.slice(1).reverse().find(point => hasLineOfSight(map, next.hunter.kinematics.position, point, next.tick)
      && crossedCells(map, next.hunter.kinematics.position, point).every(cell => isTraversable(map, cell, 'hunter'))
      && !backwardDoor(next.hunter.kinematics.position, point));
  }

  // Terrain -> movement: every proposal uses the same pre-action state.
  const proposals = actors.map(actor => {
    const action = actions[actor.id] ?? {};
    const target = actor.kind === 'hunter' ? investigationWaypoint : undefined;
    const move = target ? { x: target.x - actor.kinematics.position.x, y: target.y - actor.kinematics.position.y }
      : action.move && finiteVector(action.move) ? action.move : { x: 0, y: 0 };
    const control = { move, desiredHeading: target ? Math.atan2(move.y, move.x)
      : action.desiredHeading !== undefined && Number.isFinite(action.desiredHeading) ? action.desiredHeading : actor.kinematics.heading };
    const terrain = sampleTerrain(next.map, actor.kinematics.position);
    const proposed = integrateMotion(actor.kinematics, control, actor.kind === 'hunter' && terrain === 'mud' ? 'floor' : terrain, next.dt,
      skillSpeedMultiplier(world, actor)*(actor.kind==='hunter'?(world.hunterSpeedMultiplier??1):1));
    const cells = crossedCells(next.map, actor.kinematics.position, proposed.position);
    return { actor, cells, proposed: cells.every(cell => isTraversable(next.map, cell, actor.kind)) ? proposed : stopAt(actor.kinematics, proposed) };
  });

  // Doors: crossing a locked or backward one-way doorway rejects that movement proposal.
  for (const { actor, cells, proposed } of proposals) {
    const from = actor.kinematics;
    const blocked = next.map.doors.some(door => cells.includes(positionCell(next.map, door.position))
      && (door.lockedUntil > next.tick || (door.kind === 'oneway'
        && (proposed.position.x - from.position.x) * door.direction.x + (proposed.position.y - from.position.y) * door.direction.y < 0)));
    actor.kinematics = blocked ? stopAt(from, proposed) : proposed;
  }

  // Skills -> perception -> capture -> exposure -> last survivor (exactly once).
  if(!next.skillsDisabled)resolveWorldSkills(next, actions);
  const gaze = hunterSkillAttention(next, chasing).gazeTarget;
  if (gaze) {
    const origin = next.hunter.kinematics.position;
    next.hunter.kinematics.heading = turnHunter({ ...next.hunter, kinematics: { ...next.hunter.kinematics, heading: world.hunter.kinematics.heading } },
      Math.atan2(gaze.y - origin.y, gaze.x - origin.x), next.dt).kinematics.heading;
  }
  rules?.resolveSkills?.(next, actions);
  next.perception = advanceHunterPerception(next, world.perception);
  rules?.updatePerception?.(next, actions);
  const sortedRunners = [...next.runners].sort((a, b) => a.id.localeCompare(b.id));
  for (const runner of sortedRunners) {
    if (!runner.active) continue;
    runner.survivalSeconds += next.dt;
    if(next.stopAtOne&&next.runners.filter(r=>r.active).length<=1)continue;
    const hp = next.hunter.kinematics.position, rp = runner.kinematics.position;
    if (Math.hypot(hp.x - rp.x, hp.y - rp.y) > next.captureRadius) continue;
    const captureCells = crossedCells(next.map, hp, rp);
    if (captureCells.every(cell => isTraversable(next.map, cell, 'hunter'))
      && !next.map.doors.some(door => door.lockedUntil > next.tick
        && captureCells.includes(positionCell(next.map, door.position)))
      && (rules?.canCapture?.(next, runner) ?? true)) eliminate(next, runner, 'capture');
  }
  for (const runner of sortedRunners) {
    if (!runner.active || isInsideZone(runner.kinematics.position, next.zone)) continue;
    runner.exposure = Math.min(100, runner.exposure + next.dt * next.zone.exposureRate);
    // Fractional dt must not postpone an exact threshold by one tick due to rounding.
    if (runner.exposure >= 100 - 1e-9) {
      runner.exposure = 100;
      eliminate(next, runner, 'exposure');
    }
  }
  // Hunter immunity also holds when an extension applies a temporary skill effect.
  next.hunter.active = true;
  next.hunter.exposure = 0;
  delete next.hunter.eliminatedAt;
  delete next.hunter.eliminationReason;
  settleResult(next);
  return next;
}

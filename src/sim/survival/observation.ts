import { sampleTerrain } from './map';
import { integrateMotion } from './motion';
import { positionCell } from './pathing';
import { normalize } from './types';
import type { SurvivalMap } from './map';
import type { SkillId, SurvivalActor, TerrainKind, Vec2 } from './types';
import type { SurvivalWorld } from './world';

export const HUNTER_FOV = 150 * Math.PI / 180;
export const HUNTER_CENTRAL_FOV = 60 * Math.PI / 180;
export const HUNTER_CENTRAL_RANGE = 20;
export const HUNTER_PERIPHERAL_RANGE = 12;
export const RUNNER_SIGHT_RANGE = 10;
export const LAST_SEEN_SECONDS = 5;

export type ActorObservation = { id: string; position: Vec2; velocity: Vec2; heading: number; speedMultiplier?: number };
export type LastSeen = { id: string; position: Vec2; tick: number };
export type SensoryClue = { id: string; kind: 'sound' | 'footprint' | 'beacon'; position: Vec2; createdTick: number; expiresTick: number; strength: number };
/** Internal sensor state. Policies receive buildHunterObservation's whitelist, never this cache. */
export type SurvivalPerceptionState = {
  seed: number; tick: number;
  recognition: Record<string, { seconds: number; recognized: boolean }>;
  lastSeen: LastSeen[];
};
export type RunnerObservationMemory = { lastSeenHunter?: LastSeen & { heading: number } };
/** Only resolved skill/sensory effects belong here; coordinates always come from the world. */
export type ObservationModifiers = { scoutUntilTick?: number; dangerSenseRange?: number; clues?: readonly SensoryClue[] };
type DoorObservation = { id: string; position: Vec2; kind: 'oneway' | 'security'; direction: Vec2; locked: boolean };
type LocalTerrain = { position: Vec2; kind: TerrainKind };
export type HunterObservation = {
  tick: number; self: ActorObservation; visibleRunners: ActorObservation[]; lastSeen: LastSeen[];
  clues: SensoryClue[]; doors: DoorObservation[]; terrain: LocalTerrain[];
};
export type RunnerObservation = {
  tick: number; self: ActorObservation & { exposure: number; skill?: SkillId; skillUsed: boolean; active: boolean };
  hunter?: ActorObservation; lastSeenHunter?: LastSeen & { heading: number }; dangerDirection?: Vec2;
  visibleRunners: ActorObservation[]; clues: SensoryClue[]; doors: DoorObservation[]; terrain: LocalTerrain[];
  zone: { direction: Vec2; nextDirection?: Vec2; phase: number; warning: boolean; nextShrinkTick?: number };
};

const distance = (from: Vec2, to: Vec2) => Math.hypot(to.x - from.x, to.y - from.y);
const finitePoint = (point: Vec2) => Number.isFinite(point.x) && Number.isFinite(point.y);
const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const actorView = (actor: SurvivalActor): ActorObservation => ({ id: actor.id, position: { ...actor.kinematics.position }, velocity: { ...actor.kinematics.velocity }, heading: actor.kinematics.heading });

/** Terrain rays may report their opaque endpoint, while actor rays require a clear endpoint. */
function traceLineOfSight(map: SurvivalMap, from: Vec2, to: Vec2, tick: number, includeOpaqueTarget: boolean): boolean {
  if (positionCell(map, from) < 0 || positionCell(map, to) < 0) return false;
  const locked = new Set(map.doors.filter(door => door.lockedUntil > tick).map(door => positionCell(map, door.position)));
  const clear = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    const cell = y * map.width + x, terrain = map.terrain[cell];
    if (includeOpaqueTarget && cell === positionCell(map, to)) return true;
    return terrain !== 'wall' && terrain !== 'shelf' && !locked.has(cell);
  };
  let x = Math.floor(from.x), y = Math.floor(from.y);
  const endX = Math.floor(to.x), endY = Math.floor(to.y);
  const dx = to.x - from.x, dy = to.y - from.y, sx = Math.sign(dx), sy = Math.sign(dy);
  const stepX = dx === 0 ? Infinity : Math.abs(1 / dx), stepY = dy === 0 ? Infinity : Math.abs(1 / dy);
  let tx = dx === 0 ? Infinity : ((sx > 0 ? x + 1 : x) - from.x) / dx;
  let ty = dy === 0 ? Infinity : ((sy > 0 ? y + 1 : y) - from.y) / dy;
  if (!clear(x, y)) return false;
  while (x !== endX || y !== endY) {
    const nx = x === endX ? Infinity : tx, ny = y === endY ? Infinity : ty;
    if (Math.abs(nx - ny) < 1e-12) {
      if (!clear(x + sx, y) || !clear(x, y + sy)) return false;
      x += sx; y += sy; tx += stepX; ty += stepY;
    } else if (nx < ny) { x += sx; tx += stepX; }
    else { y += sy; ty += stepY; }
    if (!clear(x, y)) return false;
  }
  return true;
}

/** Supercover ray: even touching a solid corner blocks sight. Out-of-map rays are opaque. */
export function hasLineOfSight(map: SurvivalMap, from: Vec2, to: Vec2, tick = 0): boolean {
  return traceLineOfSight(map, from, to, tick, false);
}

function hunterAngle(hunter: SurvivalActor, point: Vec2): number {
  return Math.abs(angleDifference(Math.atan2(point.y - hunter.kinematics.position.y, point.x - hunter.kinematics.position.x), hunter.kinematics.heading));
}

/** Geometry only. Recognition additionally needs elapsed unobstructed sensor time. */
export function canHunterSee(hunter: SurvivalActor, point: Vec2, map: SurvivalMap, tick = 0): boolean {
  if (!finitePoint(point) || !Number.isFinite(hunter.kinematics.heading)) return false;
  const angle = hunterAngle(hunter, point);
  const range = angle <= HUNTER_CENTRAL_FOV / 2 + 1e-9 ? HUNTER_CENTRAL_RANGE : HUNTER_PERIPHERAL_RANGE;
  return angle <= HUNTER_FOV / 2 + 1e-9 && distance(hunter.kinematics.position, point) <= range
    && hasLineOfSight(map, hunter.kinematics.position, point, tick);
}

/** Uses the simulation's existing maximum angular speed, without advancing position. */
export function turnHunter<T extends SurvivalActor>(hunter: T, desiredHeading: number, dt: number): T {
  const heading = integrateMotion(hunter.kinematics, { move: { x: 0, y: 0 }, desiredHeading }, 'floor', dt).heading;
  return { ...hunter, kinematics: { ...hunter.kinematics, heading } };
}

export function advanceHunterPerception(world: SurvivalWorld, previous?: SurvivalPerceptionState): SurvivalPerceptionState {
  const memory = previous?.seed === world.seed && previous.tick <= world.tick ? previous : undefined;
  const elapsed = memory?.tick === world.tick ? 0 : world.dt;
  const recognition: SurvivalPerceptionState['recognition'] = {};
  const lastSeen = new Map((memory?.lastSeen ?? []).filter(seen => world.tick >= seen.tick && (world.tick - seen.tick) * world.dt <= LAST_SEEN_SECONDS).map(seen => [seen.id, { ...seen, position: { ...seen.position } }]));
  for (const runner of world.runners) {
    if (!runner.active || !canHunterSee(world.hunter, runner.kinematics.position, world.map, world.tick)) continue;
    const old = memory && world.tick - memory.tick <= 1 ? memory.recognition[runner.id] : undefined;
    const seconds = (old?.seconds ?? 0) + elapsed;
    const edge = hunterAngle(world.hunter, runner.kinematics.position) > HUNTER_CENTRAL_FOV / 2;
    const threshold = (edge ? 0.8 : 0.2) * (sampleTerrain(world.map, runner.kinematics.position) === 'shadow' ? 2 : 1);
    const recognized = old?.recognized === true || seconds + 1e-9 >= threshold;
    recognition[runner.id] = { seconds, recognized };
    if (recognized) lastSeen.set(runner.id, { id: runner.id, position: { ...runner.kinematics.position }, tick: world.tick });
  }
  return { seed: world.seed, tick: world.tick, recognition, lastSeen: [...lastSeen.values()] };
}

function localTerrain(world: SurvivalWorld, origin: Vec2, range: number): LocalTerrain[] {
  const cells: LocalTerrain[] = [];
  for (let y = Math.max(0, Math.floor(origin.y - range)); y <= Math.min(world.map.height - 1, Math.ceil(origin.y + range)); y++) {
    for (let x = Math.max(0, Math.floor(origin.x - range)); x <= Math.min(world.map.width - 1, Math.ceil(origin.x + range)); x++) {
      const position = { x: x + 0.5, y: y + 0.5 };
      if (distance(origin, position) <= range && traceLineOfSight(world.map, origin, position, world.tick, true)) cells.push({ position, kind: world.map.terrain[y * world.map.width + x]! });
    }
  }
  return cells;
}

function localDoors(world: SurvivalWorld, origin: Vec2, range: number): DoorObservation[] {
  return world.map.doors.filter(door => distance(origin, door.position) <= range
    // The door itself is observable even while closed; terrain on its far side stays occluded.
    && hasLineOfSight({ ...world.map, doors: world.map.doors.filter(other => other.id !== door.id) }, origin, door.position, world.tick))
    .map(door => ({ id: door.id, position: { ...door.position }, direction: { ...door.direction }, kind: door.kind, locked: door.lockedUntil > world.tick }));
}

function sensoryClues(world: SurvivalWorld, origin: Vec2, modifiers: ObservationModifiers): SensoryClue[] {
  return (modifiers.clues ?? []).filter(clue => finitePoint(clue.position) && positionCell(world.map, clue.position) >= 0
    && clue.createdTick <= world.tick && clue.expiresTick > world.tick && Number.isFinite(clue.strength) && clue.strength > 0
    && distance(origin, clue.position) <= (clue.kind === 'beacon' ? 30 : clue.kind === 'sound' ? 15 : 8)
    && (clue.kind !== 'footprint' || hasLineOfSight(world.map, origin, clue.position, world.tick)))
    .map(clue => ({ id: clue.id, kind: clue.kind, position: { ...clue.position }, createdTick: clue.createdTick, expiresTick: clue.expiresTick, strength: Math.min(1, clue.strength) }));
}

export function buildHunterObservation(world: SurvivalWorld, memory = advanceHunterPerception(world), modifiers: ObservationModifiers = {}): HunterObservation {
  const current = memory.seed === world.seed && memory.tick === world.tick;
  const origin = world.hunter.kinematics.position;
  return { tick: world.tick, self: {...actorView(world.hunter),...(world.hunterSpeedMultiplier!==undefined?{speedMultiplier:world.hunterSpeedMultiplier}:{})},
    visibleRunners: world.runners.filter(runner => runner.active && current && memory.recognition[runner.id]?.recognized
      && canHunterSee(world.hunter, runner.kinematics.position, world.map, world.tick)).map(actorView),
    lastSeen: memory.seed !== world.seed ? [] : memory.lastSeen.filter(seen => seen.tick <= world.tick && (world.tick - seen.tick) * world.dt <= LAST_SEEN_SECONDS)
      .map(seen => ({ id: seen.id, position: { ...seen.position }, tick: seen.tick })),
    clues: sensoryClues(world, origin, modifiers), doors: localDoors(world, origin, HUNTER_CENTRAL_RANGE), terrain: localTerrain(world, origin, HUNTER_CENTRAL_RANGE) };
}

export function buildRunnerObservation(world: SurvivalWorld, viewerId: string, memory?: RunnerObservationMemory, modifiers: ObservationModifiers = {}): RunnerObservation {
  const runner = world.runners.find(actor => actor.id === viewerId);
  if (!runner) throw new Error(`unknown runner ${viewerId}`);
  const origin = runner.kinematics.position;
  const visible = (point: Vec2) => distance(origin, point) <= RUNNER_SIGHT_RANGE && hasLineOfSight(world.map, origin, point, world.tick);
  const scout = runner.active && runner.skill === 'scout' && (modifiers.scoutUntilTick ?? -1) > world.tick;
  const hunter = visible(world.hunter.kinematics.position) || scout ? actorView(world.hunter) : undefined;
  const old = memory?.lastSeenHunter;
  const lastSeenHunter = hunter ? { id: hunter.id, position: { ...hunter.position }, heading: hunter.heading, tick: world.tick }
    : old && old.tick <= world.tick && (world.tick - old.tick) * world.dt <= LAST_SEEN_SECONDS ? { id: old.id, position: { ...old.position }, heading: old.heading, tick: old.tick } : undefined;
  let dangerDirection: Vec2 | undefined;
  if (!hunter && runner.skill === 'danger-sense' && (modifiers.dangerSenseRange ?? 0) > 0
    && distance(origin, world.hunter.kinematics.position) <= (modifiers.dangerSenseRange ?? 0)) {
    const angle = Math.round(Math.atan2(world.hunter.kinematics.position.y - origin.y, world.hunter.kinematics.position.x - origin.x) / (Math.PI / 4)) * Math.PI / 4;
    dangerDirection = { x: Math.round(Math.cos(angle) * 1000) / 1000, y: Math.round(Math.sin(angle) * 1000) / 1000 };
  }
  const toward = (point: Vec2) => normalize({ x: point.x - origin.x, y: point.y - origin.y });
  return { tick: world.tick, self: { ...actorView(runner), exposure: runner.exposure, skill: runner.skill, skillUsed: runner.skillUsed, active: runner.active },
    hunter, lastSeenHunter, dangerDirection,
    visibleRunners: world.runners.filter(actor => actor.id !== viewerId && actor.active && visible(actor.kinematics.position)).map(actorView),
    terrain: localTerrain(world, origin, RUNNER_SIGHT_RANGE), doors: localDoors(world, origin, RUNNER_SIGHT_RANGE), clues: sensoryClues(world, origin, modifiers),
    zone: { direction: toward(world.zone.anchor), nextDirection: world.zone.next ? toward(world.zone.next.anchor) : undefined, phase: world.zone.phase,
      warning: world.zone.warning, nextShrinkTick: world.zone.nextShrinkTick } };
}

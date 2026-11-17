import type { ActorObservation, HunterObservation, RunnerObservation } from '../sim/survival/observation';
import type { SkillId, Vec2 } from '../sim/survival/types';

export const OBSERVATION_SCHEMA_VERSION = 1;
export const ACTION_SCHEMA_VERSION = 1;
export const SKILL_ORDER: readonly SkillId[] = Object.freeze(['beacon', 'silent-step', 'wall-phase', 'door-override', 'sound-projection', 'adrenaline', 'scout', 'danger-sense']);

/** JSON matrices are output-major: weights[output][input]. Final layer is raw logits. */
export type PolicyModelV1 = {
  schemaVersion: 1; modelVersion: string; observationSize: number; actionSize: number;
  normalization: { mean: number[]; std: number[] };
  layers: { weights: number[][]; biases: number[]; activation: 'relu' | 'tanh' | 'linear' }[];
};
export const RUNNER_OBSERVATION_SIZE = 316;
export const HUNTER_OBSERVATION_SIZE = 313;
export const POLICY_ACTION_COUNT = 18;
/** 0 hold, then E/SE/S/SW/W/NW/N/NE; indices 9..17 repeat with skill enabled. */
export const POLICY_ACTIONS = Object.freeze([false, true].flatMap(useSkill =>
  [[0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
    .map(([x, y]) => Object.freeze({ move: Object.freeze({ x: x!, y: y! }), useSkill }))));

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const vector = (value: unknown, size: number): value is number[] => Array.isArray(value) && value.length === size && Array.from(value).every(item => typeof item === 'number' && Number.isFinite(item));
const size = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** expected must be supplied at the application boundary to reject incompatible encoders. */
export function validatePolicyModel(value: unknown, expected?: { observationSize: number; actionSize: number }): PolicyModelV1 {
  if (!record(value) || value.schemaVersion !== 1 || typeof value.modelVersion !== 'string' || !value.modelVersion.trim()) throw new Error('invalid policy schema or model version');
  if (!size(value.observationSize) || !size(value.actionSize)
    || expected && (value.observationSize !== expected.observationSize || value.actionSize !== expected.actionSize)) throw new Error('incompatible policy dimensions');
  const normalization = value.normalization;
  if (!record(normalization) || !vector(normalization.mean, value.observationSize) || !vector(normalization.std, value.observationSize)
    || normalization.std.some(item => item <= 0)) throw new Error('invalid policy normalization');
  if (!Array.isArray(value.layers) || value.layers.length === 0) throw new Error('policy requires layers');
  let width = value.observationSize;
  for (const layer of value.layers) {
    if (!record(layer) || !Array.isArray(layer.weights) || !size(layer.weights.length)
      || !Array.from(layer.weights).every(row => vector(row, width)) || !vector(layer.biases, layer.weights.length)
      || typeof layer.activation !== 'string' || !['relu', 'tanh', 'linear'].includes(layer.activation)) throw new Error('invalid policy layer');
    width = layer.weights.length;
  }
  if (width !== value.actionSize || value.layers[value.layers.length - 1].activation !== 'linear') throw new Error('invalid policy logit layer');
  return value as PolicyModelV1;
}

type Observation = HunterObservation | RunnerObservation;
const idOrder = <T extends { id: string }>(items: readonly T[]): T[] => [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const delta = (point: Vec2, origin: Vec2) => [(point.x - origin.x) / 20, (point.y - origin.y) / 20];
const terrainCodes = { floor: 1, mud: 2, shadow: 3, metal: 4, wall: 5, pipe: 6, shelf: 7 };
const clueCodes = { sound: 1, footprint: 2, beacon: 3 };
const actorSlot = (actor: ActorObservation | undefined, origin: Vec2) => actor
  ? [1, ...delta(actor.position, origin), actor.velocity.x / 2.8, actor.velocity.y / 2.8, Math.cos(actor.heading), Math.sin(actor.heading)] : Array<number>(7).fill(0);

/**
 * V1 common layout (281): self[7], 9x9 terrain[mask,kind/7] row-major,
 * 4 doors[mask,dx,dy,security,locked,dirX,dirY], 4 clues[mask,dx,dy,kind/3,strength,age/50,life/50],
 * 8 visible runners[mask,dx,dy,vx/2.8,vy/2.8,cosHeading,sinHeading]. Objects sort by ID.
 * self = [x/80,y/52,vx/2.8,vy/2.8,cosHeading,sinHeading,tick/3600]; relative positions /20.
 * Unknown slots are all zero. No world state is accepted by either encoder.
 */
function encodeCommon(observation: Observation): number[] {
  const self = observation.self, origin = self.position;
  const values = [origin.x / 80, origin.y / 52, self.velocity.x / 2.8, self.velocity.y / 2.8, Math.cos(self.heading), Math.sin(self.heading), observation.tick / 3600];
  const terrain = new Map(observation.terrain.map(cell => [`${Math.floor(cell.position.x)},${Math.floor(cell.position.y)}`, cell.kind]));
  for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
    const kind = terrain.get(`${Math.floor(origin.x) + x},${Math.floor(origin.y) + y}`);
    values.push(kind === undefined ? 0 : 1, kind === undefined ? 0 : terrainCodes[kind] / 7);
  }
  const doors = idOrder(observation.doors);
  for (let i = 0; i < 4; i++) {
    const door = doors[i];
    values.push(...(door ? [1, ...delta(door.position, origin), Number(door.kind === 'security'), Number(door.locked), door.direction.x, door.direction.y] : Array<number>(7).fill(0)));
  }
  const clues = idOrder(observation.clues);
  for (let i = 0; i < 4; i++) {
    const clue = clues[i];
    values.push(...(clue ? [1, ...delta(clue.position, origin), clueCodes[clue.kind] / 3, clue.strength, (observation.tick - clue.createdTick) / 50, (clue.expiresTick - observation.tick) / 50] : Array<number>(7).fill(0)));
  }
  const peers = idOrder(observation.visibleRunners);
  for (let i = 0; i < 8; i++) values.push(...actorSlot(peers[i], origin));
  return values;
}

/**
 * V1 runner suffix: [active,exposure/100,skillUsed,8 one-hot skills] (11), hunter (7),
 * last hunter[mask,dx,dy,cos,sin,age/50] (6), danger[mask,dirX,dirY] (3),
 * zone[dirX,dirY,nextMask,nextX,nextY,phase/5,warning,ticksToShrink/3600] (8).
 */
export function encodeRunnerObservation(observation: RunnerObservation): number[] {
  const seen = observation.lastSeenHunter, danger = observation.dangerDirection, zone = observation.zone;
  return [...encodeCommon(observation), Number(observation.self.active), observation.self.exposure / 100, Number(observation.self.skillUsed),
    ...SKILL_ORDER.map(skill => Number(observation.self.skill === skill)), ...actorSlot(observation.hunter, observation.self.position),
    ...(seen ? [1, ...delta(seen.position, observation.self.position), Math.cos(seen.heading), Math.sin(seen.heading), (observation.tick - seen.tick) / 50] : Array<number>(6).fill(0)),
    ...(danger ? [1, danger.x, danger.y] : [0, 0, 0]), zone.direction.x, zone.direction.y, Number(zone.nextDirection !== undefined),
    zone.nextDirection?.x ?? 0, zone.nextDirection?.y ?? 0, zone.phase / 5, Number(zone.warning), zone.nextShrinkTick === undefined ? 0 : (zone.nextShrinkTick - observation.tick) / 3600];
}

/** V1 hunter suffix: eight last-seen slots [mask,dx,dy,age/50], sorted by ID. */
export function encodeHunterObservation(observation: HunterObservation): number[] {
  const values = encodeCommon(observation), seen = idOrder(observation.lastSeen);
  for (let i = 0; i < 8; i++) values.push(...(seen[i] ? [1, ...delta(seen[i]!.position, observation.self.position), (observation.tick - seen[i]!.tick) / 50] : [0, 0, 0, 0]));
  return values;
}

import type { Rng } from '../sim/rng';
import type { HunterObservation, RunnerObservation } from '../sim/survival/observation';
import type { SurvivalAction, SurvivalWorld } from '../sim/survival/world';
import type { KinematicState, TerrainKind, Vec2 } from '../sim/survival/types';
import { buildHunterObservation, buildRunnerObservation, HUNTER_FOV } from '../sim/survival/observation';
import { skillObservationModifiers } from '../sim/survival/skills';
import { integrateMotion } from '../sim/survival/motion';
import { totalReward } from '../sim/survival/reward';
import { POLICY_ACTIONS } from './model-format';

type Observation = HunterObservation | RunnerObservation;
type Role = 'runner' | 'hunter';
export const FALLBACK_VERSION = 'reward-lookahead-v2';
const key = (point: Vec2) => `${Math.floor(point.x)},${Math.floor(point.y)}`;
const centre = (cell: string): Vec2 => { const [x, y] = cell.split(',').map(Number); return { x: x! + .5, y: y! + .5 }; };
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const neighbours = (point: Vec2) => [{ x: point.x - 1, y: point.y }, { x: point.x + 1, y: point.y }, { x: point.x, y: point.y - 1 }, { x: point.x, y: point.y + 1 }];
const idle = (heading: number): SurvivalAction => ({ move: { x: 0, y: 0 }, desiredHeading: heading, useSkill: false });
type Grid = ReturnType<typeof localGrid>;

/** A closed local grid: no global map, dimensions, spawn connectivity, or hidden actors. */
function localGrid(observation: Observation, role: Role) {
  const terrain = new Map(observation.terrain.map(cell => [key(cell.position), cell.kind]));
  const doors = new Map(observation.doors.map(door => [key(door.position), door]));
  const walkable = (cell: string) => {
    const kind = terrain.get(cell);
    return kind !== undefined && kind !== 'wall' && kind !== 'shelf' && !(role === 'hunter' && kind === 'pipe') && !doors.get(cell)?.locked;
  };
  const segment = (from: Vec2, to: Vec2) => {
    let x = Math.floor(from.x), y = Math.floor(from.y);
    const endX = Math.floor(to.x), endY = Math.floor(to.y), dx = to.x - from.x, dy = to.y - from.y;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const stepX = dx === 0 ? Infinity : Math.abs(1 / dx), stepY = dy === 0 ? Infinity : Math.abs(1 / dy);
    let tx = dx === 0 ? Infinity : ((sx > 0 ? x + 1 : x) - from.x) / dx;
    let ty = dy === 0 ? Infinity : ((sy > 0 ? y + 1 : y) - from.y) / dy;
    const clear = (cx: number, cy: number) => {
      const cell = `${cx},${cy}`, door = doors.get(cell);
      return walkable(cell) && !(door?.kind === 'oneway' && dx * door.direction.x + dy * door.direction.y < 0);
    };
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
  };
  return { terrain, walkable, segment };
}

function skillAllowed(observation: Observation, role: Role, grid: Grid): boolean {
  if (role !== 'runner') return false;
  const runner = observation as RunnerObservation, self = runner.self;
  if (!self.active || self.skillUsed || !self.skill) return false;
  // Wall-phase candidates additionally require an observed landing at their activation pose.
  if (self.skill === 'wall-phase') return true;
  if (self.skill === 'door-override') return observation.doors.some(door => door.kind === 'security' && !door.locked && distance(door.position, self.position) <= 1.2);
  if (self.skill === 'adrenaline') {
    const hunter = runner.hunter;
    if (!hunter || distance(self.position, hunter.position) > 9) return false;
    const angle = Math.atan2(self.position.y - hunter.position.y, self.position.x - hunter.position.x) - hunter.heading;
    return Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) <= HUNTER_FOV / 2 && grid.segment(hunter.position, self.position);
  }
  return true;
}

function activationPose(observation: Observation, action: SurvivalAction, dt: number): KinematicState {
  const terrain = observation.terrain.find(cell => key(cell.position) === key(observation.self.position))?.kind ?? 'wall';
  return integrateMotion(observation.self, { move: action.move!, desiredHeading: action.desiredHeading! }, terrain, dt,observation.self.speedMultiplier??1);
}

/** Only known cells along the current heading may validate a phase; unknown/outside is opaque. */
function phaseTarget(observation: Observation, pose: KinematicState): Vec2 | undefined {
  const grid = localGrid(observation, 'runner'), walls = new Set<string>();
  for (let step = 0; step <= 50; step++) {
    const d = step * .05, point = { x: pose.position.x + Math.cos(pose.heading) * d, y: pose.position.y + Math.sin(pose.heading) * d };
    if (point.x < 0 || point.y < 0) return;
    const kind = grid.terrain.get(key(point));
    if (kind === undefined) return;
    if (kind === 'wall' || kind === 'shelf') { walls.add(key(point)); if (walls.size > 2) return; }
    else if (walls.size > 0 && grid.walkable(key(point))) {
      const margin = Math.min(2.5, d + .05);
      const landing = { x: pose.position.x + Math.cos(pose.heading) * margin, y: pose.position.y + Math.sin(pose.heading) * margin };
      return grid.walkable(key(landing)) ? landing : point;
    }
  }
  return undefined;
}

/** Pass the same dt as masking/world. Skills activate after the first motion interval. */
export function decodePolicyAction(index: number, observation: Observation, role: Role, dt = .1): SurvivalAction {
  if (!Number.isInteger(index) || index < 0 || index >= POLICY_ACTIONS.length) throw new Error('invalid policy action index');
  const action = POLICY_ACTIONS[index]!, self = observation.self;
  const move = { ...action.move };
  const result: SurvivalAction = { move, desiredHeading: move.x || move.y ? Math.atan2(move.y, move.x) : self.heading + (role === 'hunter' ? .6 : 0), useSkill: action.useSkill };
  if (action.useSkill && role === 'runner' && (observation as RunnerObservation).self.skill === 'door-override') {
    result.interact = [...observation.doors].filter(door => door.kind === 'security' && !door.locked && distance(door.position, self.position) <= 1.2)
      .sort((a, b) => distance(a.position, self.position) - distance(b.position, self.position) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]?.id;
  }
  if (action.useSkill && role === 'runner' && (observation as RunnerObservation).self.skill === 'wall-phase') result.skillTarget = phaseTarget(observation, activationPose(observation, result, dt));
  return result;
}

function forecast(observation: Observation, role: Role, grid: Grid, action: SurvivalAction, dt: number): { state: KinematicState; legal: boolean } {
  let state: KinematicState = observation.self;
  let forecastGrid = grid;
  const steps = Math.max(1, Math.ceil(.6 / dt));
  const sprint = role === 'runner' && action.useSkill && (observation as RunnerObservation).self.skill === 'adrenaline';
  for (let i = 0; i < steps; i++) {
    let terrain: TerrainKind = forecastGrid.terrain.get(key(state.position)) ?? 'wall';
    if (role === 'hunter' && terrain === 'mud') terrain = 'floor';
    const next = integrateMotion(state, { move: action.move!, desiredHeading: action.desiredHeading! }, terrain, dt, (sprint && i > 0 ? 1.35 : 1)*(observation.self.speedMultiplier??1));
    if (!forecastGrid.segment(state.position, next.position)) return { state, legal: false };
    state = next;
    if (i === 0 && action.useSkill && role === 'runner' && (observation as RunnerObservation).self.skill === 'wall-phase') {
      if (!action.skillTarget) return { state, legal: false };
      state = { ...state, position: { ...action.skillTarget }, velocity: { x: 0, y: 0 } };
    }
    if (i === 0 && action.useSkill && role === 'runner' && (observation as RunnerObservation).self.skill === 'door-override') {
      // World resolves skills after motion. Only this candidate's future intervals see the lock.
      forecastGrid = localGrid({ ...observation, doors: observation.doors.map(door => ({ ...door, locked: door.locked || door.id === action.interact })) }, role);
    }
  }
  return { state, legal: true };
}

function legalMask(observation: Observation, role: Role, dt: number, grid: Grid): boolean[] {
  const skill = skillAllowed(observation, role, grid);
  const active = role === 'hunter' || (observation as RunnerObservation).self.active;
  return POLICY_ACTIONS.map((action, index) => {
    if (index === 0) return true; // A brake/idle request is always accepted by world collision handling.
    if (!active || action.useSkill && !skill) return false;
    const decoded = decodePolicyAction(index, observation, role, dt);
    if (action.useSkill && role === 'runner') {
      const runner = observation as RunnerObservation;
      if (runner.self.skill === 'wall-phase' && !decoded.skillTarget) return false;
      if (runner.self.skill === 'door-override') {
        const door = observation.doors.find(candidate => candidate.id === decoded.interact), position = activationPose(observation, decoded, dt).position;
        if (!door || distance(position, door.position) > 1.5 || !grid.segment(position, door.position)) return false;
      }
    }
    // Check a full neighbouring cell as well as actual momentum over the horizon.
    const nextCell = { x: observation.self.position.x + action.move.x, y: observation.self.position.y + action.move.y };
    return grid.segment(observation.self.position, nextCell) && forecast(observation, role, grid, decoded, dt).legal;
  });
}

export function buildLegalActionMask(observation: Observation, role: Role, dt: number): boolean[] {
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('invalid policy timestep');
  return legalMask(observation, role, dt, localGrid(observation, role));
}

/** Reverse directed BFS to the nearest reachable observed point toward the objective. */
function navigation(grid: Grid, origin: Vec2, target: Vec2) {
  const reachable = new Set<string>([key(origin)]), queue = [key(origin)];
  for (let head = 0; head < queue.length; head++) {
    const from = centre(queue[head]!);
    for (const to of neighbours(from)) if (!reachable.has(key(to)) && grid.segment(from, to)) { reachable.add(key(to)); queue.push(key(to)); }
  }
  const goal = [...reachable].reduce((best, cell) => distance(centre(cell), target) < distance(centre(best), target) ? cell : best, key(origin));
  const distances = new Map<string, number>([[goal, 0]]), reverse = [goal];
  for (let head = 0; head < reverse.length; head++) {
    const to = centre(reverse[head]!);
    for (const from of neighbours(to)) if (!distances.has(key(from)) && grid.segment(from, to)) {
      distances.set(key(from), distances.get(key(to))! + 1); reverse.push(key(from));
    }
  }
  const goalPoint = key(target) === goal ? target : centre(goal);
  return (point: Vec2): number => {
    if (key(point) === goal) return distance(point, goalPoint);
    const candidates = [centre(key(point)), ...neighbours(centre(key(point)))];
    return candidates.reduce((best, candidate) => grid.segment(point, candidate)
      ? Math.min(best, (distances.get(key(candidate)) ?? Infinity) + distance(point, candidate)) : best, Infinity);
  };
}

/** All scoring below uses only whitelisted observations; this function cannot read world truth. */
export function decideFromObservation(observation: Observation, role: Role, dt: number, rng: Rng): SurvivalAction {
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('invalid policy timestep');
  if (role === 'runner' && !(observation as RunnerObservation).self.active) return idle(observation.self.heading);
  const grid = localGrid(observation, role), mask = legalMask(observation, role, dt, grid), origin = observation.self.position;
  const hunter = observation as HunterObservation, runner = observation as RunnerObservation;
  const objectives = role === 'hunter' ? (hunter.visibleRunners.length ? hunter.visibleRunners : hunter.clues.some(clue => clue.kind === 'beacon')
    ? hunter.clues.filter(clue => clue.kind === 'beacon') : hunter.lastSeen.length ? hunter.lastSeen : hunter.clues).map(item => item.position)
    : runner.hunter ? [runner.hunter.position] : [];
  const objective = [...objectives].sort((a, b) => distance(a, origin) - distance(b, origin) || a.x - b.x || a.y - b.y)[0];
  const metric = objective ? navigation(grid, origin, objective) : undefined;
  const potential = (position: Vec2) => {
    const d = metric?.(position) ?? Infinity;
    return role === 'hunter' ? (Number.isFinite(d) ? .2 / (1 + d) : 0) : !metric ? .2 : .2 * Math.min(d / 20, 1);
  };
  let best = -Infinity;
  const ties: SurvivalAction[] = [];
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue;
    const action = decodePolicyAction(index, observation, role, dt), prediction = forecast(observation, role, grid, action, dt);
    const endpoint = prediction.state.position, progress = { x: endpoint.x - origin.x, y: endpoint.y - origin.y };
    const moved = distance(endpoint, origin), horizon = Math.max(1, Math.ceil(.6 / dt)) * dt;
    const zone = role === 'runner' ? runner.zone.nextDirection ?? runner.zone.direction : { x: 0, y: 0 };
    const zoneProgress = progress.x * zone.x + progress.y * zone.y;
    const noise = role === 'runner' && moved > .1 && grid.terrain.get(key(endpoint)) === 'metal';
    // Task4 features/scale: survival .1/s, bounded threat potential .2,
    // zone progress surrogate .1 (direction is all sensors expose), noise/stuck/idle -.02.
    // No skill-attempt bonus: only predicted consequences affect candidate scores.
    const score = totalReward({ survival: role === 'runner' ? .1 * horizon : 0, terminal: 0,
      capture: role === 'runner' && runner.hunter && distance(endpoint, runner.hunter.position) < .65 ? -2 : 0,
      shaping: potential(endpoint) - potential(origin),
      zone: role === 'runner' ? .1 * zoneProgress / 20 * (runner.zone.warning || runner.self.exposure > 0 ? 2 : .2) : 0,
      // Exploration is a baseline controller preference, not an additional PPO reward.
      // Keep a heading until an obstacle or observed objective asks for another direction.
      skill: 0, penalty: (!prediction.legal || moved < .01 || Math.hypot(action.move!.x,action.move!.y) === 0 ? -.02 : 0)
        + (!objective && moved > .01 ? .01 * (progress.x * Math.cos(observation.self.heading) + progress.y * Math.sin(observation.self.heading)) / moved : 0)
        - (action.useSkill ? .002 : 0)
        - (noise ? .02 * (action.useSkill && runner.self.skill === 'silent-step' ? .3 : 1) : 0)
        - (role === 'runner' && runner.self.exposure > 0 && zoneProgress <= 0 ? .02 * runner.self.exposure / 100 : 0) });
    if (score > best + 1e-12) { best = score; ties.length = 0; ties.push(action); }
    else if (Math.abs(score - best) <= 1e-12) ties.push(action);
  }
  return ties[Math.floor(rng.next() * ties.length)] ?? idle(observation.self.heading);
}

/** The only world adapter. Sensor builders own privilege; the planner receives their whitelist. */
export function decideFallback(world: SurvivalWorld, actorId: string, rng: Rng): SurvivalAction {
  const actor = actorId === world.hunter.id ? world.hunter : world.runners.find(runner => runner.id === actorId);
  if (!actor) throw new Error(`unknown actor ${actorId}`);
  if (world.phase !== 'running' || !actor.active) return idle(actor.kinematics.heading);
  const modifiers = skillObservationModifiers(world, actor);
  const observation = actor.kind === 'hunter' ? buildHunterObservation(world, world.perception, modifiers)
    : buildRunnerObservation(world, actorId, undefined, modifiers);
  return decideFromObservation(observation, actor.kind, world.dt, rng);
}

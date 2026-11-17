import { isTraversable, positionCell } from './pathing';
import { isInsideZone } from './zone';
import type { HunterObservation, RunnerObservation } from './observation';
import type { Vec2 } from './types';
import type { SurvivalWorld, SurvivalWorldActor } from './world';

export type RewardBreakdown = { survival: number; terminal: number; capture: number; zone: number; skill: number; shaping: number; penalty: number; total: number };
export type RewardEvent = {
  id: string; tick: number; actorId: string;
  type: 'effective-skill' | 'credible-discovery' | 'noise' | 'stuck' | 'ineffective-action' | 'idle' | 'spinning' | 'camping';
  effectiveness?: number;
};
export type RewardContext = {
  gamma?: number; events?: readonly RewardEvent[];
  hunterPrevious?: HunterObservation; hunterNext?: HunterObservation;
  runnerPrevious?: RunnerObservation; runnerNext?: RunnerObservation;
};

export const totalReward = (reward: Omit<RewardBreakdown, 'total'>): number => Object.values(reward).reduce((sum, value) => sum + value, 0);
const empty = (): Omit<RewardBreakdown, 'total'> => ({ survival: 0, terminal: 0, capture: 0, zone: 0, skill: 0, shaping: 0, penalty: 0 });
const finish = (reward: Omit<RewardBreakdown, 'total'>): RewardBreakdown => ({ ...reward, total: totalReward(reward) });
const unit = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
function discount(context: RewardContext): number {
  const gamma = context.gamma ?? 1;
  if (!Number.isFinite(gamma) || gamma < 0 || gamma > 1) throw new Error('reward gamma must be between zero and one');
  return gamma;
}

/** Locked door cells are excluded so distance reflects an actually usable path. */
function pathDistance(world: SurvivalWorld, from: Vec2, to: Vec2, kind: 'hunter' | 'runner'): number {
  const map = { ...world.map, terrain: [...world.map.terrain] };
  for (const door of map.doors) if (door.lockedUntil > world.tick) map.terrain[positionCell(map, door.position)] = 'wall';
  const oneWay = new Map(map.doors.filter(door => door.kind === 'oneway').map(door => [positionCell(map, door.position), door.direction]));
  // All maps use the same directed graph. A paired pipe is one interaction edge;
  // entering and leaving a one-way doorway follow the world movement direction check.
  const start = positionCell(map, from), goal = positionCell(map, to);
  if (!isTraversable(map, start, kind) || !isTraversable(map, goal, kind)) return Infinity;
  if (start === goal) return Math.hypot(to.x - from.x, to.y - from.y);
  const pipeLinks = new Map<number, number>();
  if (kind === 'runner') for (const pipe of map.pipes) {
    const a = positionCell(map, pipe.a), b = positionCell(map, pipe.b);
    pipeLinks.set(a, b); pipeLinks.set(b, a);
  }
  const steps = new Int32Array(map.terrain.length).fill(-1), queue = [start];
  steps[start] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!, x = cell % map.width, y = Math.floor(cell / map.width);
    const neighbours = [x > 0 ? cell - 1 : -1, x < map.width - 1 ? cell + 1 : -1, y > 0 ? cell - map.width : -1, y < map.height - 1 ? cell + map.width : -1];
    const pipe = pipeLinks.get(cell);
    if (pipe !== undefined) neighbours.push(pipe);
    for (const next of neighbours) {
      if (!isTraversable(map, next, kind) || steps[next] !== -1) continue;
      const dx = next % map.width - x, dy = Math.floor(next / map.width) - y;
      if ([oneWay.get(cell), oneWay.get(next)].some(direction => direction && dx * direction.x + dy * direction.y < 0)) continue;
      steps[next] = steps[cell]! + 1;
      if (next === goal) {
        const offset = (point: Vec2) => Math.hypot(point.x - Math.floor(point.x) - 0.5, point.y - Math.floor(point.y) - 0.5);
        return steps[next]! + offset(from) + offset(to);
      }
      queue.push(next);
    }
  }
  return Infinity;
}

/** Nonnegative bounded potentials make closed cycles nonprofitable (gamma <= 1). */
function hunterPotential(world: SurvivalWorld, observation?: HunterObservation): number {
  if (world.phase === 'finished' || !observation) return 0;
  const positions = [...observation.visibleRunners.map(actor => actor.position), ...observation.lastSeen.map(seen => seen.position), ...observation.clues.map(clue => clue.position)];
  const nearest = positions.reduce((best, point) => Math.min(best, pathDistance(world, observation.self.position, point, 'hunter')), Infinity);
  return Number.isFinite(nearest) ? 0.2 / (1 + nearest) : 0;
}

function runnerPotential(world: SurvivalWorld, observation?: RunnerObservation): number {
  if (world.phase === 'finished' || !observation?.self.active) return 0;
  // A hidden threat is the safest observable state; no true hidden position is consulted.
  if (!observation.hunter) return 0.2;
  const distance = pathDistance(world, observation.self.position, observation.hunter.position, 'runner');
  return Number.isFinite(distance) ? 0.2 * Math.min(distance / 20, 1) : 0.2;
}

/** A state function: objective changes and individual eliminations are part of the state. */
function zonePotential(world: SurvivalWorld, runner: SurvivalWorldActor): number {
  if (world.phase === 'finished' || !runner.active || (!world.zone.next && world.zone.phase === 0)) return 0;
  return isInsideZone(runner.kinematics.position, world.zone.next ?? world.zone) ? 0.1 : 0;
}

function freshEvents(previous: SurvivalWorld, next: SurvivalWorld, context: RewardContext): RewardEvent[] {
  const unique = new Map<string, RewardEvent>();
  for (const event of context.events ?? []) if (event.tick > previous.tick && event.tick <= next.tick) unique.set(event.id, event);
  return [...unique.values()];
}

export function scoreRunnerTransition(previous: SurvivalWorld, next: SurvivalWorld, runnerId: string, context: RewardContext = {}): RewardBreakdown {
  const reward = empty();
  if (previous.phase === 'finished' || (previous.tick === next.tick && previous.phase === next.phase)) return finish(reward);
  const before = previous.runners.find(actor => actor.id === runnerId), after = next.runners.find(actor => actor.id === runnerId);
  if (!before || !after) throw new Error(`unknown runner ${runnerId}`);
  if (!before.active) return finish(reward);
  const gamma = discount(context);
  const elapsed = Math.max(0, (next.tick - previous.tick) * previous.dt);
  reward.survival = 0.1 * Math.min(elapsed, Math.max(0, after.survivalSeconds - before.survivalSeconds));
  reward.penalty -= unit((after.exposure - before.exposure) / 100);
  if (!after.active) reward.capture = after.eliminationReason === 'capture' ? -2 : -1.5;
  if (previous.phase === 'running' && next.phase === 'finished' && next.result?.reason === 'last-survivor' && next.result.winnerId === runnerId) reward.terminal = 5;
  reward.zone = gamma * zonePotential(next, after) - zonePotential(previous, before);
  reward.shaping = gamma * runnerPotential(next, context.runnerNext) - runnerPotential(previous, context.runnerPrevious);
  for (const event of freshEvents(previous, next, context).filter(event => event.actorId === runnerId)) {
    if (event.type === 'effective-skill') reward.skill += 0.1 * unit(event.effectiveness ?? 0);
    if (['noise', 'stuck', 'ineffective-action'].includes(event.type)) reward.penalty -= 0.02;
  }
  reward.skill = Math.min(0.1, reward.skill);
  reward.penalty = Math.max(-1.2, reward.penalty);
  return finish(reward);
}

export function scoreHunterTransition(previous: SurvivalWorld, next: SurvivalWorld, context: RewardContext = {}): RewardBreakdown {
  const reward = empty();
  if (previous.phase === 'finished' || (previous.tick === next.tick && previous.phase === next.phase)) return finish(reward);
  const gamma = discount(context);
  reward.capture = next.runners.filter(after => !after.active && after.eliminationReason === 'capture' && previous.runners.some(before => before.id === after.id && before.active)).length * 2;
  if (next.phase === 'finished') {
    if (next.result?.reason === 'all-eliminated') reward.terminal = 5 + 5 * (1 - unit(next.result.tick / previous.maxTicks));
    if (next.result?.reason === 'last-survivor') reward.terminal = -5;
  }
  reward.shaping = gamma * hunterPotential(next, context.hunterNext) - hunterPotential(previous, context.hunterPrevious);
  for (const event of freshEvents(previous, next, context).filter(event => event.actorId === next.hunter.id)) {
    if (event.type === 'credible-discovery') reward.skill += 0.05 * unit(event.effectiveness ?? 0);
    if (['idle', 'spinning', 'camping', 'stuck', 'ineffective-action'].includes(event.type)) reward.penalty -= 0.02;
  }
  reward.skill = Math.min(0.1, reward.skill);
  reward.penalty = Math.max(-0.2, reward.penalty);
  return finish(reward);
}

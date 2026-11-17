import { describe, expect, it } from 'vitest';
import { createSurvivalFixture } from './fixtures';
import { buildHunterObservation, buildRunnerObservation, advanceHunterPerception } from './observation';
import { createSurvivalWorld, stepSurvivalWorld } from './world';
import { scoreHunterTransition, scoreRunnerTransition, totalReward } from './reward';
import type { SurvivalWorld } from './world';

function fixture(): SurvivalWorld {
  const map = createSurvivalFixture(['############', '#..........#', '#..........#', '#..........#', '#..........#', '#..........#', '############']);
  map.runnerSpawns = [{ x: 8.5, y: 2.5 }, { x: 8.5, y: 4.5 }]; map.hunterSpawn = { x: 2.5, y: 2.5 };
  return createSurvivalWorld({ seed: 1, map, dt: 0.1, captureRadius: 0 });
}

describe('runner transition rewards', () => {
  it('rewards elapsed survival time once with a decomposable total', () => {
    const previous = fixture(); let next = previous;
    let total = 0;
    for (let i = 0; i < 10; i++) { const before = next; next = stepSurvivalWorld(before, {}); total += scoreRunnerTransition(before, next, '01').survival; }
    expect(total).toBeCloseTo(0.1);
    expect(scoreRunnerTransition(next, next, '01').total).toBe(0);
    const reward = scoreRunnerTransition(previous, next, '01');
    const { total: sum, ...components } = reward;
    expect(sum).toBeCloseTo(totalReward(components));
    expect(reward.survival).toBeCloseTo(total);
  });

  it('does not reward door toggles or unsuccessful skill attempts', () => {
    const previous = fixture(), next = structuredClone(previous); next.tick++;
    next.map.doors.push({ id: 'door', position: { x: 5.5, y: 2.5 }, direction: { x: 1, y: 0 }, kind: 'security', lockedUntil: 5 });
    next.runners[0]!.skillUsed = true;
    expect(scoreRunnerTransition(previous, next, '01').total).toBe(0);
    expect(scoreHunterTransition(previous, next).total).toBe(0);
  });

  it('rewards only newly resolved effective skill events, once per transition', () => {
    const previous = fixture(), next = stepSurvivalWorld(previous, {});
    const context = { events: [{ id: 'skill-01', tick: next.tick, type: 'effective-skill' as const, actorId: '01', effectiveness: 1 }] };
    expect(scoreRunnerTransition(previous, next, '01', context).skill).toBeGreaterThan(0);
    expect(scoreRunnerTransition(next, next, '01', context).skill).toBe(0);
    expect(scoreRunnerTransition(previous, next, '01', { events: [...context.events, ...context.events] }).skill).toBe(scoreRunnerTransition(previous, next, '01', context).skill);
  });

  it('applies exposure and elimination penalties only when they increase', () => {
    const previous = fixture(), next = stepSurvivalWorld(previous, {});
    next.runners[0]!.exposure = 10;
    expect(scoreRunnerTransition(previous, next, '01').penalty).toBeLessThan(0);
    next.runners[0]!.active = false; next.runners[0]!.eliminationReason = 'capture';
    expect(scoreRunnerTransition(previous, next, '01').capture).toBeLessThan(0);
    expect(scoreRunnerTransition(next, next, '01').total).toBe(0);
  });

  it('cannot farm repeated safe zone entry on the same warning phase', () => {
    const outside = fixture(), inside = stepSurvivalWorld(outside, {});
    const next = { index: 1, warningTick: 0, startTick: 100, exposureRate: 1, anchor: { x: 8.5, y: 2.5 }, vertices: [{ x: 7, y: 1 }, { x: 10, y: 1 }, { x: 10, y: 5 }, { x: 7, y: 5 }] };
    outside.zone.next = inside.zone.next = next;
    outside.runners[0]!.kinematics.position = { x: 6.5, y: 2.5 };
    const enter = scoreRunnerTransition(outside, inside, '01', { gamma: 1 }).zone;
    const leave = structuredClone(outside); leave.tick = inside.tick + 1;
    expect(enter).toBeGreaterThan(0);
    expect(enter + scoreRunnerTransition(inside, leave, '01', { gamma: 1 }).zone).toBeCloseTo(0);
  });

  it.each([1, 0.99])('uses each state own zone objective across shrinking phases with gamma %s', gamma => {
    const previous = fixture();
    const phaseOne = { index: 1, warningTick: 0, startTick: 1, exposureRate: 1, anchor: { x: 8.5, y: 2.5 }, vertices: [{ x: 7, y: 1 }, { x: 10, y: 1 }, { x: 10, y: 5 }, { x: 7, y: 5 }] };
    const phaseTwo = { ...phaseOne, index: 2, startTick: 10, anchor: { x: 7.5, y: 2.5 }, vertices: [{ x: 7, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 4 }, { x: 7, y: 4 }] };
    previous.zone.next = phaseOne;
    const shrunk = structuredClone(previous); shrunk.tick++;
    shrunk.zone = { ...phaseOne, phase: 1, warning: true, next: phaseTwo };
    const entered = structuredClone(shrunk); entered.tick++;
    entered.runners[0]!.kinematics.position = { x: 7.5, y: 2.5 };
    const first = scoreRunnerTransition(previous, shrunk, '01', { gamma }).zone;
    const second = scoreRunnerTransition(shrunk, entered, '01', { gamma }).zone;
    expect(first).toBeCloseTo(-0.1, 10);
    expect(second).toBeCloseTo(gamma * 0.1, 10);
    expect(first + gamma * second).toBeCloseTo(gamma ** 2 * 0.1 - 0.1, 10);
  });

  it('zeroes an eliminated runner zone potential while other runners keep the world running', () => {
    const previous = fixture();
    previous.runners.push({ ...structuredClone(previous.runners[1]!), id: '03' });
    const next = stepSurvivalWorld(previous, {});
    next.runners[0]!.active = false; next.runners[0]!.eliminationReason = 'capture';
    expect(next.phase).toBe('running');
    expect(next.runners.filter(runner => runner.active)).toHaveLength(2);
    expect(scoreRunnerTransition(previous, next, '01', { gamma: 0.99 }).zone).toBeCloseTo(-0.1, 10);
  });

  it('rewards escaping sight and penalizes approaching a visible hunter without reading hidden coordinates', () => {
    const previous = fixture(), next = stepSurvivalWorld(previous, {});
    const runnerPrevious = buildRunnerObservation(previous, '01');
    next.map.terrain[2 * next.map.width + 5] = 'wall';
    const runnerNext = buildRunnerObservation(next, '01');
    expect(runnerNext.hunter).toBeUndefined();
    expect(scoreRunnerTransition(previous, next, '01', { runnerPrevious, runnerNext }).shaping).toBeGreaterThan(0);
    next.hunter.kinematics.position = { x: 9.1234567, y: 4.7654321 };
    expect(scoreRunnerTransition(previous, next, '01', { runnerPrevious, runnerNext }).shaping).toBeCloseTo(0.2 - 0.06);
    const approach = stepSurvivalWorld(previous, {}); approach.runners[0]!.kinematics.position.x -= 1;
    expect(scoreRunnerTransition(previous, approach, '01', { runnerPrevious, runnerNext: buildRunnerObservation(approach, '01') }).shaping).toBeLessThan(0);
  });

  it('charges one pipe interaction edge regardless of unrelated one way doors', () => {
    const previous = fixture();
    const a = { x: 7.5, y: 2.5 }, b = { x: 3.5, y: 2.5 };
    previous.map.pipes.push({ id: 'shortcut', a, b });
    previous.map.terrain[2 * previous.map.width + 7] = 'pipe';
    previous.map.terrain[2 * previous.map.width + 3] = 'pipe';
    const next = stepSurvivalWorld(previous, {}); next.runners[0]!.kinematics.position.x += 1;
    const context = { gamma: 0.99, runnerPrevious: buildRunnerObservation(previous, '01'), runnerNext: buildRunnerObservation(next, '01') };
    const withoutDoor = scoreRunnerTransition(previous, next, '01', context).shaping;
    const withDoorPrevious = structuredClone(previous), withDoorNext = structuredClone(next);
    const unrelatedDoor = { id: 'unrelated', position: { x: 10.5, y: 5.5 }, kind: 'oneway' as const, direction: { x: 1, y: 0 }, lockedUntil: 0 };
    withDoorPrevious.map.doors.push(unrelatedDoor); withDoorNext.map.doors.push(unrelatedDoor);
    const withDoor = scoreRunnerTransition(withDoorPrevious, withDoorNext, '01', context).shaping;
    expect(withoutDoor).toBeCloseTo(withDoor, 10);
    expect(withoutDoor).toBeCloseTo(0.99 * 0.04 - 0.03, 10);
  });
});

describe('hunter potential and terminal rewards', () => {
  function observed(world: SurvivalWorld) {
    let memory = advanceHunterPerception(world); const later = structuredClone(world); later.tick += 1;
    memory = advanceHunterPerception(later, memory);
    return buildHunterObservation(later, memory);
  }

  it('shapes only credible observed targets with gamma * phi(next) - phi(previous)', () => {
    const previous = fixture(), next = stepSurvivalWorld(previous, {}); next.hunter.kinematics.position.x += 1;
    expect(scoreHunterTransition(previous, next).shaping).toBe(0);
    const hunterPrevious = observed(previous), hunterNext = observed(next);
    const phi = (distance: number) => 0.2 / (1 + distance);
    expect(scoreHunterTransition(previous, next, { gamma: 0.99, hunterPrevious, hunterNext }).shaping).toBeCloseTo(0.99 * phi(5) - phi(6), 10);
    previous.runners[0]!.kinematics.position = { x: 2.5, y: 4.5 };
    expect(scoreHunterTransition(previous, next, { gamma: 0.99, hunterPrevious, hunterNext }).shaping).toBeCloseTo(0.99 * phi(5) - phi(6), 10);
  });

  it('uses path distance around walls and gives no positive reward for closed movement cycles', () => {
    const a = fixture(), b = stepSurvivalWorld(a, {}); b.hunter.kinematics.position.x += 1;
    const c = structuredClone(a); c.tick = b.tick + 1;
    const oa = observed(a), ob = observed(b), oc = observed(c);
    const forward = scoreHunterTransition(a, b, { gamma: 1, hunterPrevious: oa, hunterNext: ob }).shaping;
    expect(forward + scoreHunterTransition(b, c, { gamma: 1, hunterPrevious: ob, hunterNext: oc }).shaping).toBeCloseTo(0, 10);
    a.map.terrain[2 * a.map.width + 5] = 'wall';
    expect(scoreHunterTransition(a, b, { gamma: 1, hunterPrevious: oa, hunterNext: ob }).shaping).toBeGreaterThan(forward);
  });

  it('measures credible target distance along the allowed direction of one way doors', () => {
    const previous = fixture();
    previous.map.doors.push({ id: 'one-way', position: { x: 5.5, y: 2.5 }, direction: { x: -1, y: 0 }, kind: 'oneway', lockedUntil: 0 });
    const next = stepSurvivalWorld(previous, {}); next.hunter.kinematics.position.x += 1;
    const hunterPrevious = observed(previous), hunterNext = observed(next);
    // The door requires a two-cell detour instead of the six-cell straight corridor.
    expect(scoreHunterTransition(previous, next, { gamma: 1, hunterPrevious, hunterNext }).shaping).toBeCloseTo(0.2 / 8 - 0.2 / 9, 10);
  });

  it('does not reward full turn, stationary door cycles, or repeated ineffective actions', () => {
    const previous = fixture(), next = stepSurvivalWorld(previous, {});
    next.hunter.kinematics.heading += 2 * Math.PI;
    const observation = observed(previous);
    const context = { gamma: 1, hunterPrevious: observation, hunterNext: observation };
    expect(scoreHunterTransition(previous, next, context).total).toBe(0);
    const events = [{ id: 'spin', tick: next.tick, actorId: 'hunter', type: 'spinning' as const }];
    expect(scoreHunterTransition(previous, next, { ...context, events }).penalty).toBeLessThan(0);
    const door = { id: 'door', position: { x: 5.5, y: 2.5 }, direction: { x: 1, y: 0 }, kind: 'security' as const, lockedUntil: 10 };
    const closed = structuredClone(next); closed.tick++; closed.map.doors.push(door);
    const reopened = structuredClone(next); reopened.tick = closed.tick + 1;
    expect(scoreHunterTransition(next, closed, context).shaping + scoreHunterTransition(closed, reopened, context).shaping).toBeCloseTo(0, 10);
  });

  it('counts fresh captures and terminal outcomes once even with accumulated events', () => {
    const previous = fixture(), next = stepSurvivalWorld(previous, {});
    next.runners[1]!.active = false; next.runners[1]!.eliminationReason = 'capture';
    next.phase = 'finished'; next.result = { winnerKind: 'runner', winnerId: '01', reason: 'last-survivor', tick: next.tick, rankings: [] };
    expect(scoreRunnerTransition(previous, next, '01').terminal).toBeGreaterThan(0);
    expect(scoreHunterTransition(previous, next).capture).toBeGreaterThan(0);
    expect(scoreHunterTransition(previous, next).terminal).toBeLessThan(0);
    expect(scoreRunnerTransition(next, next, '01').total).toBe(0);
    expect(scoreHunterTransition(next, next).total).toBe(0);
  });

  it('rewards earlier full clears more and zeroes terminal potential', () => {
    const previous = fixture(), early = stepSurvivalWorld(previous, {});
    early.runners.forEach(runner => { runner.active = false; runner.eliminationReason = 'capture'; });
    early.phase = 'finished'; early.result = { winnerKind: 'hunter', winnerId: 'hunter', reason: 'all-eliminated', tick: early.tick, rankings: [] };
    const late = structuredClone(early); late.tick = previous.maxTicks - 1; late.result!.tick = late.tick;
    expect(scoreHunterTransition(previous, early).terminal).toBeGreaterThan(scoreHunterTransition(previous, late).terminal);
    const hunterPrevious = observed(previous);
    expect(scoreHunterTransition(previous, early, { hunterPrevious, hunterNext: hunterPrevious, gamma: 0.99 }).shaping).toBeCloseTo(-0.2 / 7, 10);
  });
});

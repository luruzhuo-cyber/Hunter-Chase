import { describe, expect, it } from 'vitest';
import { createSurvivalFixture } from './fixtures';
import { generateSurvivalMap } from './map';
import { findContinuousPath } from './pathing';
import { createZoneSchedule, isInsideZone, zoneAtTick } from './zone';
import { createSurvivalWorld, stepSurvivalWorld } from './world';
import type { SurvivalWorld, SurvivalWorldConfig } from './world';
import type { ZoneSchedule } from './zone';

const safeSchedule: ZoneSchedule = {
  dt: 1,
  initial: { anchor: { x: 5, y: 3 }, vertices: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 7 }, { x: 0, y: 7 }] },
  phases: [],
};
const dangerSchedule: ZoneSchedule = {
  ...safeSchedule,
  phases: [{ index: 1, warningTick: 0, startTick: 0, exposureRate: 10,
    anchor: { x: 5, y: 3 }, vertices: [{ x: 4, y: 2 }, { x: 7, y: 2 }, { x: 7, y: 5 }, { x: 4, y: 5 }] }],
};

function fixture(overrides: Partial<SurvivalWorldConfig> = {}): SurvivalWorld {
  const map = createSurvivalFixture(['############', '#..........#', '#..........#', '#..........#', '#..........#', '#..........#', '############']);
  map.runnerSpawns = [{ x: 2.5, y: 2.5 }, { x: 8.5, y: 4.5 }, { x: 5.5, y: 3.5 }];
  map.hunterSpawn = { x: 1.5, y: 5.5 };
  return createSurvivalWorld({ seed: 17, map, dt: 1, maxTicks: 100, zoneSchedule: safeSchedule, ...overrides });
}

describe('deterministic safe zones', () => {
  it('defaults new matches to 200 seconds while preserving explicit historical horizons', () => {
    expect(createSurvivalWorld({seed:1701}).maxTicks).toBe(2000);
    expect(createSurvivalWorld({seed:1701,dt:.25}).maxTicks).toBe(800);
    expect(createSurvivalWorld({seed:1701,maxTicks:3600}).maxTicks).toBe(3600);
  });
  it('builds five nested irregular phases around reachable anchors reproducibly', () => {
    for (const seed of [1, 17, 83]) {
      const map = generateSurvivalMap(seed);
      const schedule = createZoneSchedule(map, { dt: 0.25 });
      expect(schedule).toEqual(createZoneSchedule(map, { dt: 0.25 }));
      expect(schedule.phases).toHaveLength(5);
      let previous = schedule.initial;
      for (const phase of schedule.phases) {
        expect(phase.vertices.length).toBeGreaterThanOrEqual(5);
        expect(isInsideZone(phase.anchor, phase)).toBe(true);
        expect(map.futureZoneAnchors).toContainEqual(phase.anchor);
        for (const spawn of map.runnerSpawns) expect(findContinuousPath(map, spawn, phase.anchor, 'runner').length).toBeGreaterThan(0);
        expect(findContinuousPath(map, map.hunterSpawn, phase.anchor, 'hunter').length).toBeGreaterThan(0);
        expect(phase.vertices.every(vertex => isInsideZone(vertex, previous))).toBe(true);
        expect(phase.startTick - phase.warningTick).toBe(120);
        expect(polygonArea(phase.vertices)).toBeLessThan(polygonArea(previous.vertices));
        previous = phase;
      }
    }
  });

  it('warns thirty seconds before activation without shrinking early', () => {
    const schedule = createZoneSchedule(generateSurvivalMap(12), { dt: 0.25 });
    for (const phase of schedule.phases) {
      const previous = phase.index === 1 ? schedule.initial : schedule.phases[phase.index - 2]!;
      expect(zoneAtTick(schedule, phase.warningTick - 1).warning).toBe(false);
      expect(zoneAtTick(schedule, phase.warningTick)).toMatchObject({ phase: phase.index - 1, warning: true, nextShrinkTick: phase.startTick });
      expect(zoneAtTick(schedule, phase.warningTick).next).toEqual(phase);
      expect(zoneAtTick(schedule, phase.startTick - 1).vertices).toEqual(previous.vertices);
      expect(zoneAtTick(schedule, phase.startTick)).toMatchObject({ phase: phase.index, exposureRate: phase.exposureRate });
    }
    expect(zoneAtTick(schedule, schedule.phases[4]!.startTick + 100).phase).toBe(5);
  });

  it('counts polygon edges and vertices as safe', () => {
    const zone = dangerSchedule.phases[0]!;
    expect(isInsideZone({ x: 4, y: 2 }, zone)).toBe(true);
    expect(isInsideZone({ x: 4, y: 3 }, zone)).toBe(true);
    expect(isInsideZone({ x: 3.999, y: 3 }, zone)).toBe(false);
  });
});

describe('survival world settlement', () => {
  it('creates eight independent runners, one invulnerable hunter, and reproducible worlds', () => {
    const a = createSurvivalWorld({ seed: 17 });
    expect(a).toEqual(createSurvivalWorld({ seed: 17 }));
    expect(a.runners.map(runner => runner.id)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08']);
    expect(a.hunter).toMatchObject({ kind: 'hunter', active: true, exposure: 0 });
    const before = structuredClone(a);
    stepSurvivalWorld(a, {});
    expect(a).toEqual(before);
  });

  it('replays an identical action sequence into identical independent states', () => {
    let a = fixture(), b = fixture();
    for (let tick = 0; tick < 40; tick++) {
      const actions = { '01': { move: { x: Math.sin(tick), y: Math.cos(tick) }, desiredHeading: tick / 5 },
        hunter: { move: { x: 0.2, y: -0.1 }, desiredHeading: -tick / 3 } };
      a = stepSurvivalWorld(a, actions);
      b = stepSurvivalWorld(b, actions);
      expect(a).toEqual(b);
      expect(a.runners[0]).not.toBe(b.runners[0]);
    }
  });

  it('ends immediately when exactly one runner remains', () => {
    const world = fixture();
    world.runners[0]!.active = false;
    world.runners[1]!.active = false;
    const next = stepSurvivalWorld(world, {});
    expect(next.phase).toBe('finished');
    expect(next.result).toMatchObject({ winnerKind: 'runner', winnerId: '03', reason: 'last-survivor' });
    expect(stepSurvivalWorld(next, {})).toEqual(next);
  });

  it('settles an existing last survivor before another tick can capture or expose them', () => {
    const world = fixture({ zoneSchedule: dangerSchedule, rules: {
      resolveSkills() { throw new Error('a terminal world must not run skills'); },
    } });
    world.runners[1]!.active = false;
    world.runners[2]!.active = false;
    world.runners[0]!.exposure = 99;
    world.hunter.kinematics.position = { ...world.runners[0]!.kinematics.position };
    const next = stepSurvivalWorld(world, { '01': { move: { x: 1, y: 0 } } });
    expect(next.result).toMatchObject({ winnerKind: 'runner', winnerId: '01', reason: 'last-survivor', tick: 0 });
    expect(next.runners[0]).toEqual(world.runners[0]);
    expect(next.tick).toBe(0);
  });

  it('accumulates exposure outside, freezes it inside, and never applies exposure to the hunter', () => {
    const world = fixture({ zoneSchedule: dangerSchedule });
    const next = stepSurvivalWorld(world, {});
    expect(next.runners[0]!.exposure).toBe(10);
    expect(next.runners[2]!.exposure).toBe(0);
    expect(next.hunter.exposure).toBe(0);
    next.runners[0]!.kinematics.position = { x: 5, y: 3 };
    expect(stepSurvivalWorld(next, {}).runners[0]!.exposure).toBe(10);
  });

  it('restores hunter immunity after a skill extension attempts to eliminate it', () => {
    const world = fixture({ zoneSchedule: dangerSchedule, rules: { resolveSkills(next) {
      next.hunter.active = false;
      next.hunter.exposure = 100;
      next.hunter.eliminatedAt = next.tick;
      next.hunter.eliminationReason = 'exposure';
    } } });
    const next = stepSurvivalWorld(world, {});
    expect(next.hunter).toMatchObject({ active: true, exposure: 0 });
    expect(next.hunter.eliminatedAt).toBeUndefined();
    expect(next.hunter.eliminationReason).toBeUndefined();
  });

  it('uses dt and the active phase rate and eliminates at exactly 100 exposure', () => {
    const world = fixture({ dt: 0.25, zoneSchedule: { ...dangerSchedule, dt: 0.25 } });
    world.runners[0]!.exposure = 97.5;
    const next = stepSurvivalWorld(world, {});
    expect(next.runners[0]).toMatchObject({ exposure: 100, active: false, eliminationReason: 'exposure', eliminatedAt: 1 });
    expect(next.runners[1]!.exposure).toBe(2.5);
  });

  it('eliminates at the exposure threshold after repeated fractional time steps', () => {
    let world = fixture({ dt: 0.05, maxTicks: 2000, zoneSchedule: {
      ...dangerSchedule, dt: 0.05, phases: [{ ...dangerSchedule.phases[0]!, exposureRate: 2 }],
    } });
    for (let tick = 0; tick < 999; tick++) world = stepSurvivalWorld(world, {});
    expect(world.runners[0]!.active).toBe(true);
    world = stepSurvivalWorld(world, {});
    expect(world.runners[0]).toMatchObject({ active: false, exposure: 100, eliminatedAt: 1000 });
    expect(world.result).toMatchObject({ winnerKind: 'runner', winnerId: '03', tick: 1000 });
  });

  it('resolves capture before exposure and checks the survivor once after all eliminations', () => {
    const world = fixture({ zoneSchedule: dangerSchedule });
    world.runners[2]!.active = false;
    world.hunter.kinematics.position = { ...world.runners[0]!.kinematics.position };
    world.runners[0]!.exposure = 95;
    world.runners[1]!.exposure = 95;
    const next = stepSurvivalWorld(world, {});
    expect(next.runners[0]!.eliminationReason).toBe('capture');
    expect(next.runners[0]!.exposure).toBe(95);
    expect(next.runners[1]!.eliminationReason).toBe('exposure');
    expect(next.events.filter(event => event.type === 'elimination').map(event => event.reason)).toEqual(['capture', 'exposure']);
    expect(next.result).toMatchObject({ winnerKind: 'hunter', winnerId: 'hunter', reason: 'all-eliminated' });
  });

  it('awards the remaining runner after simultaneous captures without order bias', () => {
    const world = fixture();
    world.hunter.kinematics.position = { x: 2.5, y: 2.5 };
    world.runners[1]!.kinematics.position = { x: 2.6, y: 2.5 };
    expect(stepSurvivalWorld(world, {}).result).toMatchObject({ winnerKind: 'runner', winnerId: '03' });
    const reversed = { ...world, runners: [...world.runners].reverse() };
    expect(stepSurvivalWorld(reversed, {}).result).toEqual(stepSurvivalWorld(world, {}).result);
  });

  it('ends at the deadline with rankings and no last-survivor title for multiple survivors', () => {
    const world = fixture({ maxTicks: 1 });
    world.runners[0]!.exposure = 20;
    world.runners[1]!.exposure = 5;
    const next = stepSurvivalWorld(world, {});
    expect(next.result).toMatchObject({ winnerKind: 'none', reason: 'timeout' });
    expect(next.result?.winnerId).toBeUndefined();
    expect(next.result?.rankings.map(rank => rank.id)).toEqual(['03', '02', '01']);
    expect(next.result?.rankings[0]).toMatchObject({ survivalSeconds: 1, exposure: 0, insideZone: true });
  });

  it('gives last-survivor and all-eliminated precedence over a same-tick timeout', () => {
    const world = fixture({ maxTicks: 1 });
    world.hunter.kinematics.position = { ...world.runners[0]!.kinematics.position };
    world.runners[1]!.kinematics.position = { ...world.runners[0]!.kinematics.position };
    expect(stepSurvivalWorld(world, {}).result?.reason).toBe('last-survivor');
    world.runners[2]!.kinematics.position = { ...world.runners[0]!.kinematics.position };
    expect(stepSurvivalWorld(world, {}).result?.reason).toBe('all-eliminated');
  });

  it('samples terrain, moves simultaneously, resolves doors, then runs skills and perception before capture', () => {
    const stages: string[] = [];
    const world = fixture({ rules: {
      resolveSkills(next) {
        stages.push('skills');
        expect(next.runners[0]!.kinematics.position.x).toBe(2.5);
        expect(next.runners[1]!.kinematics.position.x).toBeCloseTo(5.7);
        expect(next.runners.every(runner => runner.active)).toBe(true);
      },
      updatePerception(next) {
        stages.push('perception');
        expect(next.runners.every(runner => runner.active)).toBe(true);
      },
    } });
    world.map.doors = [{ id: 'D0', kind: 'security', position: { x: 3.5, y: 2.5 }, direction: { x: 1, y: 0 }, lockedUntil: 10 }];
    const next = stepSurvivalWorld(world, { '01': { move: { x: 1, y: 0 } }, '02': { move: { x: -1, y: 0 } } });
    expect(stages).toEqual(['skills', 'perception']);
    expect(next.runners[0]!.kinematics.velocity).toEqual({ x: 0, y: 0 });
  });

  it('prevents tunnelling through walls and shelves and hunter entry into pipes', () => {
    const world = fixture();
    world.map.terrain[2 * world.map.width + 3] = 'wall';
    world.map.terrain[4 * world.map.width + 7] = 'shelf';
    world.map.terrain[5 * world.map.width + 2] = 'pipe';
    const next = stepSurvivalWorld(world, { '01': { move: { x: 1, y: 0 } }, '02': { move: { x: -1, y: 0 } }, hunter: { move: { x: 1, y: 0 } } });
    expect(next.runners[0]!.kinematics.position).toEqual(world.runners[0]!.kinematics.position);
    expect(next.runners[1]!.kinematics.position).toEqual(world.runners[1]!.kinematics.position);
    expect(next.hunter.kinematics.position).toEqual(world.hunter.kinematics.position);
  });

  it('does not capture through walls even within a large capture radius', () => {
    const world = fixture({ captureRadius: 3 });
    world.hunter.kinematics.position = { x: 2.5, y: 3.5 };
    world.runners[0]!.kinematics.position = { x: 4.5, y: 3.5 };
    world.map.terrain[3 * world.map.width + 3] = 'wall';
    expect(stepSurvivalWorld(world, {}).runners[0]!.active).toBe(true);
  });

  it.each([{ x: 2.5, y: 3.5 }, { x: 5.5, y: 2.5 }, { x: 5.5, y: 3.5 }, { x: 2.5, y: 2.5 }])('finishes capture traversal at a grid corner approached from %j', from => {
    const world = fixture({ captureRadius: 3 });
    world.hunter.kinematics.position = from;
    world.runners[0]!.kinematics.position = { x: 4, y: 3 };
    expect(stepSurvivalWorld(world, {}).runners[0]!.eliminationReason).toBe('capture');
  });

  it('blocks diagonal captures that cut the corner of an obstacle', () => {
    const world = fixture({ captureRadius: 3 });
    world.hunter.kinematics.position = { x: 2.5, y: 2.5 };
    world.runners[0]!.kinematics.position = { x: 3.5, y: 3.5 };
    world.map.terrain[2 * world.map.width + 3] = 'wall';
    expect(stepSurvivalWorld(world, {}).runners[0]!.active).toBe(true);
  });

  it('does not capture through a security door locked earlier in the same tick', () => {
    const world = fixture({ captureRadius: 3, rules: {
      resolveSkills(next) { next.map.doors[0]!.lockedUntil = 10; },
    } });
    world.hunter.kinematics.position = { x: 2.5, y: 3.5 };
    world.runners[0]!.kinematics.position = { x: 4.5, y: 3.5 };
    world.map.doors = [{ id: 'D0', kind: 'security', position: { x: 3.5, y: 3.5 }, direction: { x: 1, y: 0 }, lockedUntil: 0 }];
    expect(stepSurvivalWorld(world, {}).runners[0]!.active).toBe(true);
  });

  it('allows passage on the tick a door lock expires', () => {
    const world = fixture();
    world.map.doors = [{ id: 'D0', kind: 'security', position: { x: 3.5, y: 2.5 }, direction: { x: 1, y: 0 }, lockedUntil: 1 }];
    const next = stepSurvivalWorld(world, { '01': { move: { x: 1, y: 0 } } });
    expect(next.tick).toBe(1);
    expect(next.runners[0]!.kinematics.position.x).toBeCloseTo(5.3);
  });

  it('uses terrain speed and respects one-way doors from the same pre-action state', () => {
    const world = fixture();
    world.map.terrain[2 * world.map.width + 2] = 'mud';
    world.map.doors = [{ id: 'D0', kind: 'oneway', position: { x: 7.5, y: 4.5 }, direction: { x: 1, y: 0 }, lockedUntil: 0 }];
    const next = stepSurvivalWorld(world, { '01': { move: { x: 1, y: 0 } }, '02': { move: { x: -1, y: 0 } } });
    expect(next.runners[0]!.kinematics.position.x).toBeCloseTo(2.5 + 2.8 * 0.55);
    expect(next.runners[1]!.kinematics.position).toEqual(world.runners[1]!.kinematics.position);
  });

  it('rejects invalid timing, mismatched schedules, and unsafe zone anchors', () => {
    expect(() => fixture({ dt: 0 })).toThrow();
    expect(() => fixture({ maxTicks: 0 })).toThrow();
    expect(() => fixture({ dt: 0.5 })).toThrow();
    const map = fixture().map;
    map.futureZoneAnchors = [{ x: 0.5, y: 0.5 }];
    expect(() => createSurvivalWorld({ seed: 17, map })).toThrow();
  });
});

function polygonArea(vertices: { x: number; y: number }[]): number {
  return Math.abs(vertices.reduce((sum, vertex, index) => {
    const next = vertices[(index + 1) % vertices.length]!;
    return sum + vertex.x * next.y - next.x * vertex.y;
  }, 0)) / 2;
}

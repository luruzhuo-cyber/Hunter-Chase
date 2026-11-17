import { describe, expect, it } from 'vitest';
import { createSurvivalFixture } from './fixtures';
import { createSurvivalWorld } from './world';
import { advanceHunterPerception, buildHunterObservation, buildRunnerObservation, canHunterSee, turnHunter } from './observation';
import type { SurvivalWorld } from './world';

function fixture(): SurvivalWorld {
  const map = createSurvivalFixture(Array.from({ length: 32 }, (_, y) => y === 0 || y === 31 ? '#'.repeat(40) : `#${'.'.repeat(38)}#`));
  map.runnerSpawns = [{ x: 15.5, y: 15.5 }, { x: 2.5, y: 2.5 }, { x: 30.5, y: 25.5 }];
  map.hunterSpawn = { x: 10.5, y: 15.5 };
  return createSurvivalWorld({ seed: 1, map, dt: 0.1 });
}

describe('hunter perception', () => {
  it('uses an inclusive 150 degree cone and cannot instantly turn backward', () => {
    const world = fixture(), hunter = world.hunter;
    const point = (angle: number) => ({ x: 10.5 + 5 * Math.cos(angle), y: 15.5 + 5 * Math.sin(angle) });
    expect(canHunterSee(hunter, point(75 * Math.PI / 180), world.map)).toBe(true);
    expect(canHunterSee(hunter, point(75.1 * Math.PI / 180), world.map)).toBe(false);
    expect(canHunterSee(hunter, point(Math.PI), world.map)).toBe(false);
    const turned = turnHunter(hunter, Math.PI, 0.1);
    expect(Math.abs(turned.kinematics.heading)).toBeLessThanOrEqual(0.4);
    expect(canHunterSee(turned, point(Math.PI), world.map)).toBe(false);
    expect(hunter.kinematics.heading).toBe(0);
  });

  it('has a longer central range than peripheral vision', () => {
    const world = fixture();
    expect(canHunterSee(world.hunter, { x: 25.5, y: 15.5 }, world.map)).toBe(true);
    expect(canHunterSee(world.hunter, { x: 18, y: 28.49 }, world.map)).toBe(false);
  });

  it.each(['wall', 'shelf'] as const)('blocks sight through %s and locked doors', terrain => {
    const world = fixture();
    world.map.terrain[15 * world.map.width + 13] = terrain;
    expect(canHunterSee(world.hunter, world.runners[0]!.kinematics.position, world.map)).toBe(false);
    world.map.terrain[15 * world.map.width + 13] = 'floor';
    world.map.doors.push({ id: 'door', position: { x: 13.5, y: 15.5 }, direction: { x: 1, y: 0 }, kind: 'security', lockedUntil: 10 });
    expect(canHunterSee(world.hunter, world.runners[0]!.kinematics.position, world.map, 0)).toBe(false);
    expect(canHunterSee(world.hunter, world.runners[0]!.kinematics.position, world.map, 10)).toBe(true);
  });

  it('does not see diagonally through an exact obstacle corner', () => {
    const world = fixture();
    world.map.terrain[15 * world.map.width + 11] = 'wall';
    expect(canHunterSee(world.hunter, { x: 12.5, y: 17.5 }, world.map)).toBe(false);
  });

  it('recognizes the edge more slowly and shadows further delay recognition', () => {
    const central = fixture(), edge = fixture(), shadow = fixture();
    edge.runners[0]!.kinematics.position = { x: 13, y: 19.83 };
    shadow.runners[0]!.kinematics.position = { ...edge.runners[0]!.kinematics.position };
    shadow.map.terrain[19 * shadow.map.width + 13] = 'shadow';
    let c = advanceHunterPerception(central), e = advanceHunterPerception(edge), s = advanceHunterPerception(shadow);
    for (let tick = 1; tick <= 4; tick++) {
      central.tick = edge.tick = shadow.tick = tick;
      c = advanceHunterPerception(central, c); e = advanceHunterPerception(edge, e); s = advanceHunterPerception(shadow, s);
    }
    expect(buildHunterObservation(central, c).visibleRunners.map(actor => actor.id)).toContain('01');
    expect(buildHunterObservation(edge, e).visibleRunners).toHaveLength(0);
    for (let tick = 5; tick <= 9; tick++) {
      edge.tick = shadow.tick = tick;
      e = advanceHunterPerception(edge, e); s = advanceHunterPerception(shadow, s);
    }
    expect(buildHunterObservation(edge, e).visibleRunners.map(actor => actor.id)).toContain('01');
    expect(buildHunterObservation(shadow, s).visibleRunners).toHaveLength(0);
    for (let tick = 10; tick <= 17; tick++) { shadow.tick = tick; s = advanceHunterPerception(shadow, s); }
    expect(buildHunterObservation(shadow, s).visibleRunners.map(actor => actor.id)).toContain('01');
  });

  it('cannot accumulate recognition by reading observations repeatedly in one tick', () => {
    const world = fixture();
    let memory = advanceHunterPerception(world);
    for (let i = 0; i < 100; i++) memory = advanceHunterPerception(world, memory);
    expect(buildHunterObservation(world, memory).visibleRunners).toHaveLength(0);
  });

  it('does not assume continuous sight across unobserved simulation ticks', () => {
    const world = fixture();
    let memory = advanceHunterPerception(world);
    world.tick = 20; memory = advanceHunterPerception(world, memory);
    expect(buildHunterObservation(world, memory).visibleRunners).toHaveLength(0);
  });

  it('resets unfinished recognition when sight is interrupted', () => {
    const world = fixture();
    let memory = advanceHunterPerception(world);
    world.tick = 1; world.hunter.kinematics.heading = Math.PI;
    memory = advanceHunterPerception(world, memory);
    world.tick = 2; world.hunter.kinematics.heading = 0;
    memory = advanceHunterPerception(world, memory);
    expect(buildHunterObservation(world, memory).visibleRunners).toHaveLength(0);
    world.tick = 3; memory = advanceHunterPerception(world, memory);
    expect(buildHunterObservation(world, memory).visibleRunners.map(actor => actor.id)).toContain('01');
  });

  it('requires recognition at the actual current heading rather than an old memory snapshot', () => {
    const world = fixture();
    let memory = advanceHunterPerception(world);
    world.tick = 1; memory = advanceHunterPerception(world, memory);
    world.hunter.kinematics.heading = Math.PI;
    expect(buildHunterObservation(world, memory).visibleRunners).toHaveLength(0);
    world.tick = 2; world.hunter.kinematics.heading = 0;
    expect(buildHunterObservation(world, memory).visibleRunners).toHaveLength(0);
  });

  it('retains last seen position without updating it to hidden coordinates and expires it', () => {
    const world = fixture();
    let memory = advanceHunterPerception(world);
    world.tick = 1; memory = advanceHunterPerception(world, memory);
    world.tick = 2; memory = advanceHunterPerception(world, memory);
    const last = { ...world.runners[0]!.kinematics.position };
    world.tick = 3; world.runners[0]!.kinematics.position = { x: 5.1234567, y: 10.7654321 };
    memory = advanceHunterPerception(world, memory);
    const observation = buildHunterObservation(world, memory);
    expect(observation.visibleRunners).toHaveLength(0);
    expect(observation.lastSeen).toContainEqual({ id: '01', position: last, tick: 2 });
    expect(JSON.stringify(observation)).not.toContain('5.1234567');
    world.tick = 60; memory = advanceHunterPerception(world, memory);
    expect(buildHunterObservation(world, memory).lastSeen).toHaveLength(0);
  });
});

describe('observation isolation', () => {
  it.each(['wall', 'shelf'] as const)('observes the first adjacent %s while keeping terrain behind it unknown', kind => {
    const world = fixture();
    world.hunter.kinematics.position = { ...world.runners[0]!.kinematics.position };
    world.map.terrain[15 * world.map.width + 16] = kind;
    world.map.terrain[15 * world.map.width + 18] = 'shelf';
    for (const observation of [buildRunnerObservation(world, '01'), buildHunterObservation(world)]) {
      expect(observation.terrain.find(cell => cell.position.x === 16.5 && cell.position.y === 15.5)).toEqual({ position: { x: 16.5, y: 15.5 }, kind });
      expect(observation.terrain.some(cell => cell.position.x === 17.5 && cell.position.y === 15.5)).toBe(false);
      expect(observation.terrain.some(cell => cell.position.x === 18.5 && cell.position.y === 15.5)).toBe(false);
    }
    expect(canHunterSee(world.hunter, { x: 17.5, y: 15.5 }, world.map)).toBe(false);
  });

  it('does not disclose hidden actor or spawn coordinates, result rankings or recognition state', () => {
    const world = fixture();
    world.runners[1]!.kinematics.position = { x: 5.1234567, y: 10.7654321 };
    world.map.runnerSpawns[1] = { ...world.runners[1]!.kinematics.position };
    const observation = buildHunterObservation(world);
    expect(JSON.stringify(observation)).not.toContain('5.1234567');
    expect(observation).not.toHaveProperty('runners');
    expect(observation).not.toHaveProperty('map');
    expect(observation).not.toHaveProperty('recognition');
  });

  it('lets runners see only local unobstructed characters and detached local terrain', () => {
    const world = fixture();
    world.hunter.kinematics.position = { x: 35.1234567, y: 20.7654321 };
    const observation = buildRunnerObservation(world, '01');
    expect(observation.hunter).toBeUndefined();
    expect(JSON.stringify(observation)).not.toContain('35.1234567');
    expect(observation.visibleRunners).toHaveLength(0);
    expect(observation.terrain.length).toBeLessThan(world.map.terrain.length);
    observation.self.position.x = 1000;
    expect(world.runners[0]!.kinematics.position.x).toBe(15.5);
    world.hunter.kinematics.position = { x: 17.5, y: 15.5 };
    expect(buildRunnerObservation(world, '01').hunter?.position).toEqual(world.hunter.kinematics.position);
    world.map.terrain[15 * world.map.width + 16] = 'wall';
    expect(buildRunnerObservation(world, '01').hunter).toBeUndefined();
  });

  it('only grants exact global scout information during the scout skill window', () => {
    const world = fixture();
    world.hunter.kinematics.position = { x: 35.1234567, y: 20.7654321 };
    expect(buildRunnerObservation(world, '01', undefined, { scoutUntilTick: 5 }).hunter).toBeUndefined();
    world.runners[0]!.skill = 'scout';
    expect(buildRunnerObservation(world, '01', undefined, { scoutUntilTick: 5 }).hunter?.position).toEqual(world.hunter.kinematics.position);
    world.tick = 5;
    expect(buildRunnerObservation(world, '01', undefined, { scoutUntilTick: 5 }).hunter).toBeUndefined();
  });

  it('filters expired and out of range clues and gives danger sense only a coarse direction', () => {
    const world = fixture();
    world.hunter.kinematics.position = { x: 15.5, y: 20.1234567 };
    world.map.terrain[17 * world.map.width + 15] = 'wall';
    world.runners[0]!.skill = 'danger-sense';
    expect(buildRunnerObservation(world, '01').dangerDirection).toBeUndefined();
    const clue = { id: 'real-sound', kind: 'sound' as const, position: { x: 16, y: 20 }, createdTick: 0, expiresTick: 10, strength: 2 };
    const observation = buildRunnerObservation(world, '01', undefined, { dangerSenseRange: 12, clues: [clue, { ...clue, id: 'expired', expiresTick: 0 }, { ...clue, id: 'remote', position: { x: 38.5, y: 30.5 } }] });
    expect(observation.hunter).toBeUndefined();
    expect(observation.dangerDirection).toEqual({ x: 0, y: 1 });
    expect(JSON.stringify(observation)).not.toContain('20.1234567');
    expect(observation.clues).toEqual([{ ...clue, strength: 1 }]);
    observation.clues[0]!.position.x = 1;
    expect(clue.position.x).toBe(16);
  });
});

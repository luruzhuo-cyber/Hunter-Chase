import { describe, expect, it } from 'vitest';
import { createSurvivalFixture } from './fixtures';
import { buildRunnerObservation } from './observation';
import { advanceHunterPerception } from './observation';
import { isTraversable, positionCell } from './pathing';
import { Rng } from '../rng';
import { canUseSkill, resolveSkill, resolveWorldSkills, skillObservationModifiers, acousticStrength, skillSpeedMultiplier, hunterSkillAttention } from './skills';
import { createSurvivalWorld, stepSurvivalWorld } from './world';
import type { SurvivalWorld } from './world';

function fixture(dt = .1): SurvivalWorld {
  const map = createSurvivalFixture(Array.from({ length: 24 }, (_, y) => y === 0 || y === 23 ? '#'.repeat(36) : `#${'.'.repeat(34)}#`));
  map.runnerSpawns = Array.from({ length: 8 }, (_, i) => ({ x: 3.5 + i * 2, y: 4.5 }));
  map.hunterSpawn = { x: 30.5, y: 18.5 };
  return createSurvivalWorld({ seed: 1, map, dt, captureRadius: 0 });
}

describe('single use survival skills', () => {
  it('adrenaline retains normal acceleration and brakes to rest after releasing movement at dt .05', () => {
    let world = fixture(.05);
    world.hunter.kinematics.position = { x: 16.5, y: 4.5 };
    world.hunter.kinematics.heading = Math.PI;
    world = stepSurvivalWorld(world, { '06': { useSkill: true } });
    expect(world.runners[5]!.skillUsed).toBe(true);
    for (let tick = 1; tick <= 8; tick++) {
      world = stepSurvivalWorld(world, { '06': { move: { x: 1, y: 0 } } });
    }
    const topSpeed = world.runners[5]!.kinematics.velocity.x;
    expect(topSpeed).toBeCloseTo(3.78, 10);
    for (let tick = 1; tick <= 8; tick++) {
      world = stepSurvivalWorld(world, {});
      expect(world.runners[5]!.kinematics.velocity.x).toBeCloseTo(Math.max(0, topSpeed - tick * .5), 10);
    }
    const stopped = { ...world.runners[5]!.kinematics.position };
    world = stepSurvivalWorld(world, {});
    expect(world.runners[5]!.kinematics.position).toEqual(stopped);
  });

  it('adrenaline changes the speed ceiling while keeping acceleration at 10 cells per second squared', () => {
    let world = fixture(.05);
    world.hunter.kinematics.position = { x: 16.5, y: 4.5 };
    world.hunter.kinematics.heading = Math.PI;
    world = stepSurvivalWorld(world, { '06': { useSkill: true } });
    for (let tick = 1; tick <= 8; tick++) {
      world = stepSurvivalWorld(world, { '06': { move: { x: 1, y: 0 } } });
      expect(world.runners[5]!.kinematics.velocity.x).toBeCloseTo(Math.min(tick * .5, 2.8 * 1.35), 10);
    }
  });

  it('world activation gives adrenaline exactly 24 subsequent movement integrations', () => {
    let world = fixture();
    world.hunter.kinematics.position = { x: 16.5, y: 4.5 };
    world.hunter.kinematics.heading = Math.PI;
    world.runners[5]!.kinematics.velocity = { x: 2.8, y: 0 };
    world = stepSurvivalWorld(world, { '06': { useSkill: true, move: { x: 1, y: 0 } } });
    const activatedX = world.runners[5]!.kinematics.position.x;
    expect(world.runners[5]!.kinematics.velocity.x).toBeCloseTo(2.8, 10);
    for (let integration = 1; integration <= 24; integration++) {
      world = stepSurvivalWorld(world, { '06': { move: { x: 1, y: 0 } } });
      expect(world.runners[5]!.kinematics.velocity.x).toBeCloseTo(3.78, 10);
      expect(world.runners[5]!.kinematics.position.x).toBeCloseTo(activatedX + integration * .378, 10);
    }
    world = stepSurvivalWorld(world, { '06': { move: { x: 1, y: 0 } } });
    expect(world.runners[5]!.kinematics.velocity.x).toBeCloseTo(2.8, 10);
  });

  it('world activation gives beacon exactly 12 subsequent investigation movement integrations', () => {
    let world = fixture();
    for (const runner of world.runners) runner.kinematics.position = { x: 3.5, y: 4.5 };
    world = stepSurvivalWorld(world, { '01': { useSkill: true } });
    world.runners[0]!.active = false;
    const origin = world.hunter.kinematics.position, length = Math.hypot(27, 14);
    for (let integration = 1; integration <= 12; integration++) {
      world = stepSurvivalWorld(world, { hunter: { move: { x: 1, y: 0 } } });
      const speed = Math.min(integration, 2.8);
      expect(world.hunter.kinematics.velocity.x).toBeCloseTo(-27 / length * speed, 10);
      expect(world.hunter.kinematics.velocity.y).toBeCloseTo(-14 / length * speed, 10);
    }
    expect(world.hunter.kinematics.position.x).toBeLessThan(origin.x);
    const previous = world.hunter.kinematics.velocity.x;
    world = stepSurvivalWorld(world, { hunter: { move: { x: 1, y: 0 } } });
    expect(world.hunter.kinematics.velocity.x).toBeGreaterThan(previous);
  });

  it('world activation advances echo exactly 48 times before discarding its terminal snapshot', () => {
    let world = stepSurvivalWorld(fixture(), { '05': { useSkill: true } });
    const origin = { ...world.skills.effects.find(effect => effect.skill === 'sound-projection')!.position };
    for (let integration = 1; integration <= 48; integration++) {
      world = stepSurvivalWorld(world, {});
      const effect = world.skills.effects.find(candidate => candidate.skill === 'sound-projection');
      expect(effect).toBeDefined();
      expect(effect!.position).toEqual({ x: expect.closeTo(origin.x + integration * .28, 10), y: origin.y });
    }
    expect(skillObservationModifiers(world, world.hunter).clues!.find(clue => clue.id.startsWith('skill-clue:05:'))).toBeUndefined();
    world = stepSurvivalWorld(world, {});
    expect(world.skills.effects.find(effect => effect.skill === 'sound-projection')).toBeUndefined();
  });

  it('rejects second valid use of each skill and never mutates state on invalid attempts or validation', () => {
    for (let index = 0; index < 8; index++) {
      const world = fixture(), actor = world.runners[index]!;
      let intent = {};
      if (index === 2) {
        world.map.terrain[4 * world.map.width + 8] = 'wall';
        intent = { skillTarget: { x: 9.5, y: 4.5 } };
      }
      if (index === 3) {
        world.map.doors = [{ id: 'D', position: { x: 10.5, y: 4.5 }, kind: 'security', direction: { x: 1, y: 0 }, lockedUntil: 0 }];
        intent = { interact: 'D' };
      }
      if (index === 5) {
        world.hunter.kinematics.position = { x: actor.kinematics.position.x + 3, y: 4.5 };
        world.hunter.kinematics.heading = Math.PI;
      }
      const before = structuredClone(world);
      expect(canUseSkill(world, actor, intent)).toBe(true);
      expect(world).toEqual(before);
      expect(resolveSkill(world, actor, intent).ok).toBe(true);
      const used = structuredClone(world);
      expect(canUseSkill(world, actor, intent)).toBe(false);
      expect(resolveSkill(world, actor, intent)).toEqual({ ok: false, reason: 'already-used' });
      expect(world).toEqual(used);
      expect(world.skillEvents).toHaveLength(1);
    }
    const world = fixture();
    const before = structuredClone(world);
    expect(resolveSkill(world, world.runners[3]!, { interact: 'missing' }).ok).toBe(false);
    expect(resolveSkill(world, world.runners[5]!, {}).ok).toBe(false);
    expect(resolveSkill(world, world.runners[2]!, { skillTarget: { x: NaN, y: Infinity } })).toEqual({ ok: false, reason: 'invalid-landing' });
    expect(world).toEqual(before);
  });

  it('keeps 1000 seeded wall-phase landings in bounds and walkable, including nonvacuous successes', () => {
    const rng = new Rng(571), world = fixture(), actor = world.runners[2]!;
    let successes = 0, rejections = 0;
    for (let attempt = 0; attempt < 1000; attempt++) {
      actor.skillUsed = false;
      actor.kinematics.position = { x: 3.5, y: 4.5 };
      actor.kinematics.heading = 0;
      world.map.terrain[4 * world.map.width + 4] = 'wall';
      let target = { x: 5 + rng.next(), y: 4.5 };
      if (attempt % 4 !== 0) {
        actor.kinematics.position = { x: 1 + rng.next() * 33, y: 1 + rng.next() * 21 };
        actor.kinematics.heading = rng.next() * Math.PI * 2;
        const range = rng.next() * 4;
        target = attempt % 4 === 1 ? { x: -5 + rng.next() * 45, y: -5 + rng.next() * 34 }
          : { x: actor.kinematics.position.x + Math.cos(actor.kinematics.heading) * range,
            y: actor.kinematics.position.y + Math.sin(actor.kinematics.heading) * range };
      }
      const origin = { ...actor.kinematics.position };
      const result = resolveSkill(world, actor, { skillTarget: target });
      if (result.ok) {
        successes++;
        const position = actor.kinematics.position;
        expect(positionCell(world.map, position)).toBeGreaterThanOrEqual(0);
        expect(isTraversable(world.map, positionCell(world.map, position), 'runner')).toBe(true);
        expect(Math.hypot(position.x - origin.x, position.y - origin.y)).toBeLessThanOrEqual(2.5);
      } else {
        rejections++;
        expect(actor.skillUsed).toBe(false);
        expect(actor.kinematics.position).toEqual(origin);
      }
    }
    expect(successes).toBeGreaterThanOrEqual(250);
    expect(rejections).toBeGreaterThanOrEqual(700);
  });

  it('beacon makes the hunter navigate around a wall while an established direct chase keeps its movement', () => {
    const world = fixture();
    world.hunter.kinematics.position = { x: 10.5, y: 10.5 };
    world.runners[0]!.kinematics.position = { x: 8.5, y: 10.5 };
    world.map.terrain[10 * world.map.width + 9] = 'wall';
    resolveSkill(world, world.runners[0]!, {});
    let next = world;
    for (let tick = 0; tick < 6; tick++) next = stepSurvivalWorld(next, {});
    expect(next.hunter.kinematics.position.y).not.toBe(10.5);

    const chase = fixture();
    chase.hunter.kinematics.position = { x: 10.5, y: 10.5 };
    chase.runners[1]!.kinematics.position = { x: 12.5, y: 10.5 };
    chase.perception = advanceHunterPerception(chase);
    chase.tick++;
    chase.perception = advanceHunterPerception(chase, chase.perception);
    expect(chase.perception.recognition['02']!.recognized).toBe(true);
    resolveSkill(chase, chase.runners[0]!, {});
    const moving = stepSurvivalWorld(chase, { hunter: { move: { x: 1, y: 0 }, desiredHeading: Math.PI } });
    expect(moving.hunter.kinematics.position.x).toBeGreaterThan(chase.hunter.kinematics.position.x);
    expect(moving.hunter.kinematics.position.y).toBe(chase.hunter.kinematics.position.y);
    expect(Math.abs(moving.hunter.kinematics.heading - chase.hunter.kinematics.heading)).toBeLessThanOrEqual(.4 + 1e-9);
  });

  it('world movement uses adrenaline and generated metal sound and footprints use quiet-step strength', () => {
    const base = fixture(), boosted = fixture();
    for (const world of [base, boosted]) {
      world.hunter.kinematics.position = { x: 16.5, y: 4.5 };
      world.hunter.kinematics.heading = Math.PI;
      world.runners[5]!.kinematics.velocity = { x: 2.8, y: 0 };
      world.map.terrain[4 * world.map.width + 5] = 'metal';
    }
    resolveSkill(boosted, boosted.runners[5]!, {});
    resolveSkill(boosted, boosted.runners[1]!, {});
    const actions = { '06': { move: { x: 1, y: 0 } }, '02': { move: { x: 1, y: 0 } } };
    const a = stepSurvivalWorld(base, actions), b = stepSurvivalWorld(boosted, actions);
    expect(b.runners[5]!.kinematics.position.x - 13.5).toBeCloseTo((a.runners[5]!.kinematics.position.x - 13.5) * 1.35);
    for (const kind of ['sound', 'footprint'] as const) expect(b.skills.clues.find(clue => clue.id === `${kind}:02:1`)!.strength).toBeCloseTo(.3);
  });

  it('beacon investigation routes around a backward one-way doorway', () => {
    let world = fixture();
    world.hunter.kinematics.position = { x: 10.5, y: 10.5 };
    world.runners[0]!.kinematics.position = { x: 8.5, y: 10.5 };
    world.map.doors = [{ id: 'oneway', position: { x: 9.5, y: 10.5 }, kind: 'oneway', direction: { x: 1, y: 0 }, lockedUntil: 0 }];
    resolveSkill(world, world.runners[0]!, {});
    for (let tick = 0; tick < 6; tick++) world = stepSurvivalWorld(world, {});
    expect(world.hunter.kinematics.position.y).not.toBe(10.5);
  });

  it('beacon investigation smooths only hunter-walkable segments and routes around a visible pipe', () => {
    let world = fixture();
    world.hunter.kinematics.position = { x: 10.5, y: 10.5 };
    world.runners[0]!.kinematics.position = { x: 8.5, y: 10.5 };
    for (const runner of world.runners.slice(1)) runner.kinematics.position = { x: 30.5, y: 20.5 };
    world.map.terrain[10 * world.map.width + 9] = 'pipe';
    world = stepSurvivalWorld(world, { '01': { useSkill: true } });
    // A placed beacon continues after its owner is eliminated; no visible runner can cancel investigation.
    world.runners[0]!.active = false;
    for (let tick = 0; tick < 10; tick++) {
      world = stepSurvivalWorld(world, {});
      expect(isTraversable(world.map, positionCell(world.map, world.hunter.kinematics.position), 'hunter')).toBe(true);
    }
    expect(world.hunter.kinematics.position.y).not.toBe(10.5);
    expect(world.hunter.kinematics.position.x).toBeLessThan(9.5);
  });

  it('stale perception cannot cancel a forced beacon investigation', () => {
    const world = fixture();
    world.hunter.kinematics.position = { x: 10.5, y: 10.5 };
    world.runners[0]!.kinematics.position = { x: 8.5, y: 10.5 };
    world.runners[1]!.kinematics.position = { x: 12.5, y: 10.5 };
    world.perception = { seed: 999, tick: -1, recognition: { '02': { seconds: 1, recognized: true } }, lastSeen: [] };
    resolveSkill(world, world.runners[0]!, {});
    const next = stepSurvivalWorld(world, { hunter: { move: { x: 1, y: 0 } } });
    expect(next.hunter.kinematics.position.x).toBeLessThan(world.hunter.kinematics.position.x);
  });

  it('world resolves only explicit intents in the skills slot before perception and capture', () => {
    const world = fixture();
    world.rules = { updatePerception(next) { expect(next.runners[6]!.skillUsed).toBe(true); } };
    const next = stepSurvivalWorld(world, { '07': { useSkill: true } });
    expect(next.runners[6]!.skillUsed).toBe(true);
    expect(next.runners[0]!.skillUsed).toBe(false);
    expect(next.skillEvents).toHaveLength(1);
    expect(world.runners[6]!.skillUsed).toBe(false);
  });

  it('rejects inactive actors, hunter, finished rounds, blocked or already longer-locked doors without effects', () => {
    const world = fixture();
    world.runners[0]!.active = false;
    expect(resolveSkill(world, world.runners[0]!, {}).ok).toBe(false);
    expect(resolveSkill(world, world.hunter, {}).ok).toBe(false);
    const actor = world.runners[3]!;
    world.map.doors = [{ id: 'D', position: { x: 10.5, y: 4.5 }, kind: 'security', direction: { x: 1, y: 0 }, lockedUntil: 100 }];
    expect(resolveSkill(world, actor, { interact: 'D' }).ok).toBe(false);
    expect(world.map.doors[0]!.lockedUntil).toBe(100);
    world.map.doors[0]!.lockedUntil = 0;
    world.map.terrain[4 * world.map.width + 10] = 'wall';
    expect(resolveSkill(world, actor, { interact: 'D' }).ok).toBe(false);
    world.phase = 'finished';
    expect(resolveSkill(world, world.runners[6]!, {}).ok).toBe(false);
    expect(world.skillEvents).toEqual([]);
    expect(world.skills.effects).toEqual([]);
  });

  it('rejects isolated pockets and out of bounds phase destinations without consumption', () => {
    const world = fixture(), actor = world.runners[2]!;
    actor.kinematics.position = { x: 3.5, y: 4.5 };
    for (const [x, y] of [[4, 4], [5, 3], [5, 5], [6, 4]]) world.map.terrain[y! * world.map.width + x!] = 'wall';
    expect(resolveSkill(world, actor, { skillTarget: { x: 5.5, y: 4.5 } })).toEqual({ ok: false, reason: 'invalid-landing' });
    actor.kinematics.position = { x: 1.5, y: 4.5 };
    actor.kinematics.heading = Math.PI;
    expect(resolveSkill(world, actor, { skillTarget: { x: -.5, y: 4.5 } })).toEqual({ ok: false, reason: 'invalid-landing' });
    expect(actor.skillUsed).toBe(false);
    expect(world.skillEvents).toEqual([]);
  });

  it('decoys do not advance twice in a tick, and a JSON restored match replays skill state deterministically', () => {
    let world = fixture();
    resolveSkill(world, world.runners[4]!, {});
    world.tick++;
    resolveWorldSkills(world, {});
    const once = structuredClone(world);
    resolveWorldSkills(world, {});
    expect(world).toEqual(once);
    let restored = JSON.parse(JSON.stringify(world)) as SurvivalWorld;
    for (let tick = 0; tick < 25; tick++) {
      const actions = { '07': { useSkill: tick === 0 }, '02': { useSkill: tick === 1, move: { x: 1, y: 0 } } };
      world = stepSurvivalWorld(world, actions);
      restored = stepSurvivalWorld(restored, actions);
      expect(restored).toEqual(world);
    }
  });

  it('beacon overrides investigation for 12 ticks and gaze for 4 without freezing translation', () => {
    let world = fixture();
    const actor = world.runners[0]!;
    expect(resolveSkill(world, actor, {})).toMatchObject({ ok: true });
    expect(hunterSkillAttention(world)).toEqual({ investigationTarget: actor.kinematics.position, gazeTarget: actor.kinematics.position });
    const before = { ...world.hunter.kinematics.position };
    world = stepSurvivalWorld(world, { hunter: { move: { x: -1, y: 0 } } });
    expect(world.hunter.kinematics.position.x).toBeLessThan(before.x);
    expect(Math.abs(world.hunter.kinematics.heading)).toBeLessThanOrEqual(.4 + 1e-9);
    world.tick = 4;
    expect(hunterSkillAttention(world).gazeTarget).toBeUndefined();
    expect(hunterSkillAttention(world).investigationTarget).toEqual(actor.kinematics.position);
    expect(hunterSkillAttention(world, true).investigationTarget).toBeUndefined();
    world.tick = 12;
    expect(hunterSkillAttention(world).investigationTarget).toBeUndefined();
  });

  it('quiet step reduces footsteps and metal acoustics by 70 percent for 40 ticks', () => {
    const world = fixture(), actor = world.runners[1]!;
    expect(resolveSkill(world, actor, {}).ok).toBe(true);
    expect(acousticStrength(world, actor, 1)).toBeCloseTo(.3);
    world.tick = 39;
    expect(acousticStrength(world, actor, 2)).toBeCloseTo(.6);
    world.tick = 40;
    expect(acousticStrength(world, actor, 2)).toBe(2);
  });

  it('wall phase crosses a wall along heading at most 2.5 cells and rejects invalid landing without consuming', () => {
    const world = fixture(), actor = world.runners[2]!;
    actor.kinematics.position = { x: 3.5, y: 4.5 };
    world.map.terrain[4 * world.map.width + 4] = 'wall';
    expect(resolveSkill(world, actor, { skillTarget: { x: 4.5, y: 4.5 } })).toEqual({ ok: false, reason: 'invalid-landing' });
    expect(actor.skillUsed).toBe(false);
    expect(resolveSkill(world, actor, { skillTarget: { x: 6.01, y: 4.5 } }).ok).toBe(false);
    expect(resolveSkill(world, actor, { skillTarget: { x: 5.5, y: 5.5 } }).ok).toBe(false);
    expect(resolveSkill(world, actor, { skillTarget: { x: 6, y: 4.5 } }).ok).toBe(true);
    expect(actor.kinematics.position).toEqual({ x: 6, y: 4.5 });
  });

  it('locksmith locks only a nearby security door for 32 ticks', () => {
    const world = fixture(), actor = world.runners[3]!;
    world.map.doors = [{ id: 'D', position: { x: 10.5, y: 4.5 }, kind: 'security', direction: { x: 1, y: 0 }, lockedUntil: 0 }];
    expect(resolveSkill(world, actor, { interact: 'D' }).ok).toBe(true);
    expect(world.map.doors[0]!.lockedUntil).toBe(32);
  });

  it('echo projects a moving sound for 48 ticks at lower priority than beacon', () => {
    const world = fixture(), actor = world.runners[4]!;
    expect(resolveSkill(world, actor, { skillTarget: { x: 20.5, y: 4.5 } }).ok).toBe(true);
    const first = skillObservationModifiers(world, world.hunter).clues!.find(clue => clue.kind === 'sound')!;
    world.tick = 1;
    resolveWorldSkills(world, {});
    const next = skillObservationModifiers(world, world.hunter).clues!.find(clue => clue.kind === 'sound')!;
    expect(next.position.x).toBeGreaterThan(first.position.x);
    expect(next.expiresTick).toBe(48);
    resolveSkill(world, world.runners[0]!, {});
    expect(skillObservationModifiers(world, world.hunter).clues!.find(clue => clue.kind === 'beacon')!.strength).toBeGreaterThan(next.strength);
    world.tick = 48;
    expect(skillObservationModifiers(world, world.hunter).clues!.filter(clue => clue.kind === 'sound')).toEqual([]);
  });

  it('adrenaline multiplies speed by 1.35 for 24 ticks under direct threat', () => {
    const world = fixture(), actor = world.runners[5]!;
    world.hunter.kinematics.position = { x: actor.kinematics.position.x + 3, y: actor.kinematics.position.y };
    world.hunter.kinematics.heading = Math.PI;
    expect(resolveSkill(world, actor, {}).ok).toBe(true);
    expect(skillSpeedMultiplier(world, actor)).toBe(1.35);
    world.tick = 23;
    expect(skillSpeedMultiplier(world, actor)).toBe(1.35);
    world.tick = 24;
    expect(skillSpeedMultiplier(world, actor)).toBe(1);
  });

  it('raven reveals exact current hunter position and heading for 20 ticks', () => {
    const world = fixture(), actor = world.runners[6]!;
    expect(resolveSkill(world, actor, {}).ok).toBe(true);
    world.hunter.kinematics.heading = 1.3;
    const view = () => buildRunnerObservation(world, actor.id, undefined, skillObservationModifiers(world, actor));
    expect(view().hunter).toMatchObject({ position: world.hunter.kinematics.position, heading: 1.3 });
    world.tick = 19;
    expect(view().hunter).toBeDefined();
    world.tick = 20;
    expect(view().hunter).toBeUndefined();
  });

  it('watchman gives only an eight-direction bearing within 10 cells when hunter is hidden', () => {
    const world = fixture(), actor = world.runners[7]!;
    world.hunter.kinematics.position = { x: actor.kinematics.position.x + 6, y: actor.kinematics.position.y + 3 };
    world.map.terrain[5 * world.map.width + 20] = 'wall';
    expect(resolveSkill(world, actor, {}).ok).toBe(true);
    const view = () => buildRunnerObservation(world, actor.id, undefined, skillObservationModifiers(world, actor));
    expect(view().hunter).toBeUndefined();
    expect(view().dangerDirection).toEqual({ x: .707, y: .707 });
    expect(view().lastSeenHunter).toBeUndefined();
    world.hunter.kinematics.position.x += 10;
    expect(view().dangerDirection).toBeUndefined();
  });

  it('watchman quantizes all eight octants without revealing hidden pose or distance', () => {
    for (let octant = 0; octant < 8; octant++) {
      const world = fixture(), actor = world.runners[7]!, angle = octant * Math.PI / 4 + .1;
      actor.kinematics.position = { x: 17.5, y: 12.5 };
      world.hunter.kinematics.position = { x: 17.5 + 7 * Math.cos(angle), y: 12.5 + 7 * Math.sin(angle) };
      world.map.terrain[Math.floor(12.5 + 3 * Math.sin(angle)) * world.map.width + Math.floor(17.5 + 3 * Math.cos(angle))] = 'wall';
      resolveSkill(world, actor, {});
      const observation = buildRunnerObservation(world, actor.id, undefined, skillObservationModifiers(world, actor));
      expect(observation.hunter).toBeUndefined();
      expect(observation.lastSeenHunter).toBeUndefined();
      expect(observation.dangerDirection!.x).toBeCloseTo(Math.round(Math.cos(octant * Math.PI / 4) * 1000) / 1000, 10);
      expect(observation.dangerDirection!.y).toBeCloseTo(Math.round(Math.sin(octant * Math.PI / 4) * 1000) / 1000, 10);
    }
  });
});

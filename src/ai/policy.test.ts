import { describe, expect, it, vi } from 'vitest';
import { Rng } from '../sim/rng';
import { validatePolicyModel, encodeRunnerObservation, encodeHunterObservation, RUNNER_OBSERVATION_SIZE, HUNTER_OBSERVATION_SIZE, POLICY_ACTIONS, POLICY_ACTION_COUNT } from './model-format';
import type { PolicyModelV1 } from './model-format';
import { runPolicy } from './mlp';
import { buildHunterObservation, buildRunnerObservation } from '../sim/survival/observation';
import { createSurvivalFixture } from '../sim/survival/fixtures';
import { createSurvivalWorld } from '../sim/survival/world';
import { stepSurvivalWorld } from '../sim/survival/world';
import { canUseSkill } from '../sim/survival/skills';
import { decideFallback, decideFromObservation, buildLegalActionMask, decodePolicyAction } from './fallback-policy';

function model(): PolicyModelV1 {
  return { schemaVersion: 1, modelVersion: 'fixture-1', observationSize: 2, actionSize: 2,
    normalization: { mean: [0, 0], std: [1, 1] },
    layers: [{ weights: [[1, -1], [-1, 1]], biases: [0, 0], activation: 'relu' },
      { weights: [[.5, 0], [-.5, 0]], biases: [0, 0], activation: 'linear' }] };
}

function fixture() {
  const map = createSurvivalFixture(Array.from({ length: 24 }, (_, y) => y === 0 || y === 23 ? '#'.repeat(36) : `#${'.'.repeat(34)}#`));
  map.runnerSpawns = Array.from({ length: 8 }, (_, i) => ({ x: 3.5 + i * 2, y: 4.5 }));
  map.hunterSpawn = { x: 30.5, y: 18.5 };
  return createSurvivalWorld({ seed: 1, map, captureRadius: 0 });
}

describe('versioned JSON policy runtime', () => {
  it('evaluates a known two-layer network exactly', () => {
    expect(runPolicy(model(), [1, 0], new Rng(1)).logits).toEqual([.5, -.5]);
  });

  it('loads a JSON roundtrip, normalizes inputs and supports arbitrary widths and tanh', () => {
    const json = model();
    json.normalization = { mean: [1, 2], std: [2, 4] };
    expect(runPolicy(validatePolicyModel(JSON.parse(JSON.stringify(json))), [3, 2], new Rng(1)).logits).toEqual([.5, -.5]);
    json.layers = [{ weights: [[1, 0], [0, 1], [1, 1]], biases: [0, 0, 0], activation: 'tanh' },
      { weights: [[1, 1, 1], [-1, -1, -1]], biases: [.25, -.25], activation: 'linear' }];
    expect(runPolicy(json, [3, 2], new Rng(1)).logits[0]).toBeCloseTo(2 * Math.tanh(1) + .25, 12);
  });

  it.each([
    ['schema', (m: any) => { m.schemaVersion = 2; }],
    ['version', (m: any) => { m.modelVersion = ''; }],
    ['normalization', (m: any) => { delete m.normalization; }],
    ['std', (m: any) => { m.normalization.std[0] = 0; }],
    ['mean', (m: any) => { m.normalization.mean = [0]; }],
    ['finite weights', (m: any) => { m.layers[0].weights[0][0] = NaN; }],
    ['finite biases', (m: any) => { m.layers[1].biases[0] = Infinity; }],
    ['input size', (m: any) => { m.observationSize = 3; }],
    ['output size', (m: any) => { m.actionSize = 3; }],
    ['layer dimensions', (m: any) => { m.layers[1].weights[0] = [1]; }],
    ['activation', (m: any) => { m.layers[0].activation = 'softmax'; }],
    ['non-string activation', (m: any) => { m.layers[0].activation = ['relu']; }],
    ['output activation', (m: any) => { m.layers[1].activation = 'relu'; }],
    ['no layers', (m: any) => { m.layers = []; }],
  ])('rejects malformed %s', (_, mutate) => {
    const invalid = model(); mutate(invalid);
    expect(() => validatePolicyModel(invalid)).toThrow();
  });

  it('rejects incompatible expected dimensions before inference', () => {
    expect(() => validatePolicyModel(model(), { observationSize: 3, actionSize: 2 })).toThrow();
    expect(() => validatePolicyModel(model(), { observationSize: 2, actionSize: 3 })).toThrow();
    expect(() => runPolicy(model(), [1], new Rng(1))).toThrow();
    expect(() => runPolicy(model(), [Infinity, 0], new Rng(1))).toThrow();
  });

  it('uses supplied RNG for sampling, with reproducible sequences and varied samples', () => {
    const a = new Rng(53), b = new Rng(53), c = new Rng(54);
    const sample = (rng: Rng) => Array.from({ length: 40 }, () => runPolicy(model(), [0, 0], rng).actionIndex);
    const first = sample(a);
    expect(first).toEqual(sample(b));
    expect(first).not.toEqual(sample(c));
    expect(new Set(first).size).toBe(2);
  });

  it('masks illegal actions even when their logits dominate and uses stable softmax', () => {
    const m = model(); m.layers[1].biases = [1e200, -1e200];
    const rng = new Rng(7);
    for (let i = 0; i < 30; i++) {
      const result = runPolicy(m, [0, 0], rng, [false, true]);
      expect(result.actionIndex).toBe(1);
      expect(result.probabilities).toEqual([0, 1]);
    }
    expect(runPolicy(m, [0, 0], rng).probabilities).toEqual([1, 0]);
  });

  it('rejects malformed masks, fully masked states, and nonfinite inference results', () => {
    for (const mask of [[false, false], [true], [true, 1]]) expect(() => runPolicy(model(), [0, 0], new Rng(1), mask as boolean[])).toThrow();
    const m = model(); m.layers[0].weights[0][0] = Number.MAX_VALUE;
    expect(() => runPolicy(m, [2, 0], new Rng(1))).toThrow();
  });

  it('does not consult ambient random sources in either runtime', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('ambient RNG consulted'); });
    try {
      expect(runPolicy(model(), [0, 0], new Rng(5)).actionIndex).toBeGreaterThanOrEqual(0);
      expect(decideFallback(fixture(), 'hunter', new Rng(5)).move).toBeDefined();
    } finally { random.mockRestore(); }
  });
});

describe('observation-only fallback planning', () => {
  it('moves the hunter toward a recognized target without mutating the world', () => {
    const world = fixture();
    world.hunter.kinematics.position = { x: 12.5, y: 10.5 };
    world.runners[0]!.kinematics.position = { x: 17.5, y: 10.5 };
    world.perception = { seed: world.seed, tick: world.tick, recognition: { '01': { seconds: 1, recognized: true } }, lastSeen: [] };
    const before = JSON.stringify(world);
    const action = decideFallback(world, 'hunter', new Rng(1));
    expect(action.move!.x).toBeGreaterThan(0);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('makes runners retreat from visible threats and approach the warned safe-zone direction', () => {
    const world = fixture();
    world.hunter.kinematics.position = { x: 6.5, y: 4.5 };
    const observation = buildRunnerObservation(world, '01');
    observation.self.skillUsed = true;
    observation.zone.direction = { x: 0, y: 0 };
    expect(decideFromObservation(observation, 'runner', .1, new Rng(1)).move!.x).toBeLessThan(0);
    observation.hunter = undefined;
    observation.zone = { direction: { x: 1, y: 0 }, nextDirection: { x: 1, y: 0 }, warning: true, phase: 2 };
    expect(decideFromObservation(observation, 'runner', .1, new Rng(1)).move!.x).toBeGreaterThan(0);
  });

  it('does not change decisions when hidden opponents or occluded map cells change', () => {
    const world = fixture(), altered = structuredClone(world);
    altered.hunter.kinematics.position = { x: 31.5, y: 18.5 };
    altered.runners[7]!.kinematics.position = { x: 28.5, y: 19.5 };
    altered.map.terrain[20 * altered.map.width + 30] = 'mud';
    expect(buildRunnerObservation(world, '01')).toEqual(buildRunnerObservation(altered, '01'));
    expect(decideFallback(world, '01', new Rng(15))).toEqual(decideFallback(altered, '01', new Rng(15)));
    const hunterAltered = structuredClone(world);
    hunterAltered.runners.forEach(actor => { actor.kinematics.position = { x: 3.5, y: 3.5 }; });
    expect(buildHunterObservation(world)).toEqual(buildHunterObservation(hunterAltered));
    expect(decideFallback(world, 'hunter', new Rng(15))).toEqual(decideFallback(hunterAltered, 'hunter', new Rng(15)));
  });

  it('obeys walls, pipe restrictions, locked and backward one-way doors, and unknown cells', () => {
    const world = fixture(); world.hunter.kinematics.position = { x: 12.5, y: 10.5 };
    const observation = buildHunterObservation(world);
    observation.terrain = [{ position: { x: 12.5, y: 10.5 }, kind: 'floor' }, { position: { x: 13.5, y: 10.5 }, kind: 'pipe' }];
    expect(buildLegalActionMask(observation, 'hunter', .1).slice(0, 9)).toEqual([true, false, false, false, false, false, false, false, false]);
    observation.terrain[1]!.kind = 'floor';
    expect(buildLegalActionMask(observation, 'hunter', .1)[1]).toBe(true);
    observation.doors = [{ id: 'gate', position: { x: 13.5, y: 10.5 }, kind: 'security', locked: true, direction: { x: 1, y: 0 } }];
    expect(buildLegalActionMask(observation, 'hunter', .1)[1]).toBe(false);
    observation.doors[0]!.kind = 'oneway'; observation.doors[0]!.locked = false; observation.doors[0]!.direction.x = -1;
    expect(buildLegalActionMask(observation, 'hunter', .1)[1]).toBe(false);
    observation.doors[0]!.direction.x = 1;
    expect(buildLegalActionMask(observation, 'hunter', .1)[1]).toBe(true);
  });

  it('masks skill actions for hunters, used skills, and unavailable landing information', () => {
    const world = fixture();
    expect(buildLegalActionMask(buildHunterObservation(world), 'hunter', .1).slice(9)).toEqual(Array(9).fill(false));
    const runner = buildRunnerObservation(world, '03');
    expect(buildLegalActionMask(runner, 'runner', .1).slice(9)).toEqual(Array(9).fill(false));
    runner.self.skill = 'scout'; runner.self.skillUsed = true;
    expect(buildLegalActionMask(runner, 'runner', .1).slice(9)).toEqual(Array(9).fill(false));
    runner.self.skillUsed = false;
    expect(buildLegalActionMask(runner, 'runner', .1)[9]).toBe(true);
    expect(() => decodePolicyAction(99, runner, 'runner')).toThrow();
  });

  it('enables wall-phase only for observed forward landings and decodes a bounded legal target', () => {
    const world = fixture(), actor = world.runners[2]!;
    actor.kinematics.position = { x: 3.5, y: 10.5 };
    world.map.terrain[10 * world.map.width + 4] = 'wall';
    const observation = buildRunnerObservation(world, '03');
    // A remembered/otherwise observed landing can be supplied by a sensor; never query world here.
    observation.terrain.push({ position: { x: 5.5, y: 10.5 }, kind: 'floor' });
    expect(buildLegalActionMask(observation, 'runner', .1)[9]).toBe(true);
    const action = decodePolicyAction(9, observation, 'runner');
    expect(action.skillTarget!.x).toBeGreaterThan(5);
    expect(action.skillTarget!.x - actor.kinematics.position.x).toBeLessThanOrEqual(2.5);
    expect(canUseSkill(world, actor, action)).toBe(true);
    const next = stepSurvivalWorld(world, { '03': action });
    expect(next.runners[2]!.skillUsed).toBe(true);
    expect(next.runners[2]!.kinematics.position).toEqual(action.skillTarget);
    observation.terrain = observation.terrain.filter(cell => Math.floor(cell.position.x) <= 4);
    expect(buildLegalActionMask(observation, 'runner', .1)[9]).toBe(false);
    observation.self.position = { x: .5, y: 10.5 }; observation.self.heading = Math.PI;
    observation.terrain = [{ position: { x: .5, y: 10.5 }, kind: 'floor' }, { position: { x: -.5, y: 10.5 }, kind: 'wall' }, { position: { x: -1.5, y: 10.5 }, kind: 'floor' }];
    expect(buildLegalActionMask(observation, 'runner', .1)[9]).toBe(false);
  });

  it('checks door skill range at the predicted activation position for each action', () => {
    const observation = buildRunnerObservation(fixture(), '04');
    observation.self.position = { x: 12.5, y: 10.5 };
    observation.terrain = Array.from({ length: 8 }, (_, x) => ({ position: { x: 9.5 + x, y: 10.5 }, kind: 'floor' as const }));
    observation.doors = [{ id: 'near', position: { x: 11.5, y: 10.5 }, kind: 'security', direction: { x: 1, y: 0 }, locked: false }];
    expect(buildLegalActionMask(observation, 'runner', 1)[9]).toBe(true);
    expect(buildLegalActionMask(observation, 'runner', 1)[10]).toBe(false);
  });

  it('predicts door-override locking after the first movement interval without mutating source state', () => {
    const world = fixture(), actor = world.runners[3]!;
    actor.kinematics.position = { x: 12.95, y: 10.5 };
    world.map.doors = [{ id: 'security', position: { x: 13.5, y: 10.5 }, kind: 'security', direction: { x: 1, y: 0 }, lockedUntil: 0 }];
    const observation = buildRunnerObservation(world, actor.id);
    const originalWorld = JSON.stringify(world), originalObservation = JSON.stringify(observation);
    const action = decodePolicyAction(10, observation, 'runner', world.dt);
    const locked = stepSurvivalWorld(world, { [actor.id]: action });
    expect(locked.runners[3]!.kinematics.position.x).toBeCloseTo(13.05, 12);
    expect(locked.map.doors[0]!.lockedUntil).toBeGreaterThan(locked.tick);
    let trapped = locked;
    for (let i = 0; i < 5; i++) trapped = stepSurvivalWorld(trapped, { [actor.id]: { move: { x: 1, y: 0 } } });
    expect(trapped.runners[3]!.kinematics.position.x).toBeCloseTo(13.05, 12);
    const mask = buildLegalActionMask(observation, 'runner', world.dt);
    expect(mask[1]).toBe(true); // Crossing an unlocked door without locking remains feasible.
    expect(mask[9]).toBe(true); // Locking from the adjacent cell does not trap the actor.
    expect(mask[10]).toBe(false); // East+lock must not forecast a path through its own lock.
    expect(JSON.stringify(world)).toBe(originalWorld);
    expect(JSON.stringify(observation)).toBe(originalObservation);
  });

  it('ties break reproducibly with supplied seeds and remain independent of ambient randomness', () => {
    const observation = buildHunterObservation(fixture());
    const a = new Rng(98), b = new Rng(98), c = new Rng(99);
    const sample = (rng: Rng) => Array.from({ length: 20 }, () => decideFromObservation(observation, 'hunter', .1, rng));
    expect(sample(a)).toEqual(sample(b));
    expect(sample(c)).toHaveLength(20); // Different seeds may agree when persistence has one best direction.
  });

  it('chooses only allowed skill intents and keeps inactive and terminal actors idle', () => {
    const world = fixture();
    for (const actor of world.runners) {
      const action = decideFallback(world, actor.id, new Rng(7));
      if (action.useSkill) expect(canUseSkill(world, actor, action)).toBe(true);
    }
    world.runners[0]!.active = false;
    expect(decideFallback(world, '01', new Rng(1)).move).toEqual({ x: 0, y: 0 });
    world.phase = 'finished';
    expect(decideFallback(world, 'hunter', new Rng(1)).move).toEqual({ x: 0, y: 0 });
    expect(() => decideFallback(world, 'missing', new Rng(1))).toThrow();
  });

  it('finishes a seed-identical match with legal positions and JSON replay parity', () => {
    let a = fixture(), b = structuredClone(a);
    a.maxTicks = 20; b.maxTicks = 20;
    const ra = new Rng(7), rb = new Rng(7);
    for (let tick = 0; tick < 20; tick++) {
      const play = (world: typeof a, rng: Rng) => Object.fromEntries([world.hunter, ...world.runners].map(actor => [actor.id, decideFallback(world, actor.id, rng)]));
      a = stepSurvivalWorld(a, play(a, ra));
      b = stepSurvivalWorld(JSON.parse(JSON.stringify(b)), play(b, rb));
    }
    expect(a).toEqual(b);
    expect(a.phase).toBe('finished');
    expect(a.result).toBeDefined();
    for (const actor of [a.hunter, ...a.runners]) {
      const cell = Math.floor(actor.kinematics.position.y) * a.map.width + Math.floor(actor.kinematics.position.x);
      expect(['wall', 'shelf']).not.toContain(a.map.terrain[cell]);
    }
  });
});

describe('fixed policy observation and action contracts', () => {
  it('encodes runner fields in a stable documented order and pads absent objects with zero', () => {
    const observation = buildRunnerObservation(fixture(), '01');
    const values = encodeRunnerObservation(observation);
    expect(values).toHaveLength(RUNNER_OBSERVATION_SIZE);
    expect(values.slice(0, 7)).toEqual([3.5 / 80, 4.5 / 52, 0, 0, 1, 0, 0]);
    expect(values.every(Number.isFinite)).toBe(true);
    const empty = { ...observation, hunter: undefined, lastSeenHunter: undefined, visibleRunners: [], terrain: [], clues: [], doors: [] };
    expect(encodeRunnerObservation(empty).slice(7, 281)).toEqual(Array(274).fill(0));
    expect(encodeRunnerObservation(empty).slice(292, 305)).toEqual(Array(13).fill(0));
    expect(encodeRunnerObservation(structuredClone(observation))).toEqual(values);
  });

  it('encodes hunter observations independent of incoming entity array order', () => {
    const observation = buildHunterObservation(fixture());
    observation.clues = [
      { id: 'b', kind: 'sound', position: { x: 5, y: 5 }, createdTick: 0, expiresTick: 10, strength: .5 },
      { id: 'a', kind: 'beacon', position: { x: 4, y: 4 }, createdTick: 0, expiresTick: 10, strength: 1 },
    ];
    observation.lastSeen = [{ id: '02', tick: 0, position: { x: 4, y: 5 } }, { id: '01', tick: 0, position: { x: 5, y: 4 } }];
    const values = encodeHunterObservation(observation);
    expect(values).toHaveLength(HUNTER_OBSERVATION_SIZE);
    expect(values.every(Number.isFinite)).toBe(true);
    expect(encodeHunterObservation({ ...observation, clues: [...observation.clues].reverse(), lastSeen: [...observation.lastSeen].reverse(), terrain: [...observation.terrain].reverse() })).toEqual(values);
    expect(RUNNER_OBSERVATION_SIZE).toBe(316);
    expect(HUNTER_OBSERVATION_SIZE).toBe(313);
  });

  it('publishes a stable eighteen-action table with independent skill controls', () => {
    expect(POLICY_ACTION_COUNT).toBe(18);
    expect(POLICY_ACTIONS).toHaveLength(18);
    expect(POLICY_ACTIONS[0]).toEqual({ move: { x: 0, y: 0 }, useSkill: false });
    expect(POLICY_ACTIONS[1]).toEqual({ move: { x: 1, y: 0 }, useSkill: false });
    expect(POLICY_ACTIONS[9]).toEqual({ move: { x: 0, y: 0 }, useSkill: true });
  });
});

describe('fallback exploration regression', () => {
  it('maintains a patrol direction instead of random-walking around spawn without clues', () => {
    let world = fixture();
    world.hunter.kinematics.position = { x: 10.5, y: 18.5 };
    const initial = { ...world.hunter.kinematics.position };
    for (let tick = 0; tick < 80; tick++) {
      const observation = buildHunterObservation(world);
      observation.visibleRunners = []; observation.lastSeen = []; observation.clues = [];
      const action=decideFromObservation(observation, 'hunter', world.dt, new Rng(tick + 100));
      world = stepSurvivalWorld(world, { hunter: action });
    }
    expect(Math.hypot(world.hunter.kinematics.position.x - initial.x, world.hunter.kinematics.position.y - initial.y)).toBeGreaterThan(10);
  });

  it('does not spend the beacon at spawn without a perceived threat', () => {
    const observation = buildRunnerObservation(fixture(), '01');
    observation.hunter = undefined; observation.clues = []; observation.dangerDirection = undefined;
    for (let seed = 0; seed < 30; seed++) expect(decideFromObservation(observation, 'runner', .1, new Rng(seed)).useSkill).toBe(false);
  });
  it('finds and captures a stationary visible target in a basic pursuit scenario', () => {
    let world = fixture();
    world.captureRadius = .65;
    world.hunter.kinematics.position = {x:5.5,y:10.5};
    world.runners[0]!.kinematics.position = {x:12.5,y:10.5};
    for(let tick=0;tick<120&&world.runners[0]!.active;tick++)
      world=stepSurvivalWorld(world,{hunter:decideFallback(world,'hunter',new Rng(200+tick))});
    expect(world.runners[0]!.eliminationReason).toBe('capture');
  });
});

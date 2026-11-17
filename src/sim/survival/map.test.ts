import { describe, expect, it } from 'vitest';
import { generateSurvivalMap, sampleTerrain, validateSurvivalMap } from './map';
import { findContinuousPath } from './pathing';
import { createSurvivalFixture } from './fixtures';
import { integrateMotion, RUNNER_SPEED } from './motion';

describe('survival facility generation', () => {
  it('generates deterministic 80x52 maps with every terrain family', () => {
    const a = generateSurvivalMap(1701), b = generateSurvivalMap(1701);
    expect(a).toEqual(b);
    expect([a.width, a.height]).toEqual([80, 52]);
    for (const kind of ['shadow', 'mud', 'metal', 'pipe', 'shelf']) expect(a.terrain).toContain(kind);
    expect(validateSurvivalMap(a)).toEqual({ valid: true, errors: [] });
    expect(generateSurvivalMap(1702).terrain).not.toEqual(a.terrain);
  });

  it('subdivides six modules into small rooms and connects a looped room graph', () => {
    const map = generateSurvivalMap(77);
    expect(map.rooms.length).toBeGreaterThanOrEqual(14);
    expect(map.rooms.length).toBeLessThanOrEqual(20);
    const small = map.rooms.filter(room => room.kind === 'small');
    expect(new Set(small.map(room => room.moduleId)).size).toBeGreaterThanOrEqual(6);
    for (const room of small) {
      expect(room.width).toBeGreaterThanOrEqual(3);
      expect(room.width).toBeLessThanOrEqual(6);
      expect(room.height).toBeGreaterThanOrEqual(3);
      expect(room.height).toBeLessThanOrEqual(5);
    }
    expect(map.corridors.length).toBeGreaterThanOrEqual(map.rooms.length);
    const visited = new Set([map.rooms[0]!.id]);
    for (let pass = 0; pass < map.rooms.length; pass++) {
      for (const edge of map.corridors) {
        if (visited.has(edge.from)) visited.add(edge.to);
        if (visited.has(edge.to)) visited.add(edge.from);
      }
    }
    expect(visited.size).toBe(map.rooms.length);
    expect(map.doors.map(door => door.kind)).toEqual(expect.arrayContaining(['oneway', 'security']));
  });

  it('preserves two-cell aisles on both sides of warehouse shelves', () => {
    const map = generateSurvivalMap(18);
    expect(map.shelves.length).toBeGreaterThan(0);
    for (const shelf of map.shelves) {
      for (let x = shelf.x; x < shelf.x + shelf.width; x++) {
        expect(sampleTerrain(map, { x: x + 0.5, y: shelf.y + 0.5 })).toBe('shelf');
        for (const offset of [-2, -1, 1, 2]) {
          expect(['wall', 'shelf', 'pipe']).not.toContain(sampleTerrain(map, { x: x + 0.5, y: shelf.y + offset + 0.5 }));
        }
      }
    }
  });

  it('provides eight dispersed runner spawns, an edge hunter entry and reachable zone anchors', () => {
    const map = generateSurvivalMap(46);
    expect(map.runnerSpawns).toHaveLength(8);
    expect(new Set(map.runnerSpawns.map(point => `${point.x},${point.y}`)).size).toBe(8);
    expect(Math.min(map.hunterSpawn.x, map.width - map.hunterSpawn.x, map.hunterSpawn.y, map.height - map.hunterSpawn.y)).toBeLessThanOrEqual(3);
    expect(map.futureZoneAnchors.length).toBeGreaterThanOrEqual(3);
    for (const point of [...map.runnerSpawns, ...map.futureZoneAnchors]) {
      expect(findContinuousPath(map, map.hunterSpawn, point, 'hunter').length).toBeGreaterThan(0);
    }
    expect(map.pipes).toHaveLength(2);
    for (const pipe of map.pipes) {
      expect(sampleTerrain(map, pipe.a)).toBe('pipe');
      expect(sampleTerrain(map, pipe.b)).toBe('pipe');
    }
  });

  it('closes each corridor doorway locally while preserving a distant facility loop over 500 seeds', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const map = generateSurvivalMap(seed);
      expect(map.doors, `seed ${seed}`).toHaveLength(2);
      for (const door of map.doors) {
        const label = `seed ${seed} door ${door.id}`;
        const { position, direction } = door;
        expect(map.rooms.some(room => position.x >= room.x && position.x < room.x + room.width
          && position.y >= room.y && position.y < room.y + room.height), label).toBe(false);
        const before = { x: position.x - direction.x, y: position.y - direction.y };
        const after = { x: position.x + direction.x, y: position.y + direction.y };
        const across = { x: -direction.y, y: direction.x };
        for (const side of [-1, 1]) {
          expect(sampleTerrain(map, { x: position.x + side * across.x, y: position.y + side * across.y }), label).toBe('wall');
        }
        expect(findContinuousPath(map, before, after, 'hunter'), label).toEqual([before, position, after]);
        const closed = { ...map, terrain: [...map.terrain] };
        closed.terrain[Math.floor(position.y) * map.width + Math.floor(position.x)] = 'wall';
        const local = { ...closed, terrain: closed.terrain.map((kind, index) => {
          const x = index % map.width + 0.5, y = Math.floor(index / map.width) + 0.5;
          return Math.abs(x - position.x) <= 4 && Math.abs(y - position.y) <= 4 ? kind : 'wall';
        }) };
        expect(findContinuousPath(local, before, after, 'hunter'), label).toEqual([]);
        const detour = findContinuousPath(closed, before, after, 'hunter');
        expect(detour.length, label).toBeGreaterThan(10);
        expect(validateSurvivalMap(closed).errors, label).toEqual([]);
      }
      const allClosed = { ...map, terrain: [...map.terrain] };
      for (const door of map.doors) allClosed.terrain[Math.floor(door.position.y) * map.width + Math.floor(door.position.x)] = 'wall';
      expect(validateSurvivalMap(allClosed).errors, `seed ${seed} simultaneous locks`).toEqual([]);
    }
  }, 30_000);

  it('validates every generated facility over 500 seeds', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const map = generateSurvivalMap(seed);
      expect(validateSurvivalMap(map).errors, `seed ${seed}`).toEqual([]);
      expect(map.rooms.length, `seed ${seed}`).toBeGreaterThanOrEqual(14);
      expect(map.rooms.length, `seed ${seed}`).toBeLessThanOrEqual(20);
      expect(map.rooms.filter(room => room.kind === 'small').length, `seed ${seed}`).toBeGreaterThanOrEqual(6);
      expect(new Set(map.rooms.filter(room => room.kind === 'small').map(room => room.moduleId)).size, `seed ${seed}`).toBeGreaterThanOrEqual(6);
      for (const kind of ['shadow', 'mud', 'metal', 'pipe', 'shelf']) expect(map.terrain, `seed ${seed}`).toContain(kind);
      expect(map.pipes, `seed ${seed}`).toHaveLength(2);
      for (const door of map.doors) expect(['wall', 'shelf', 'pipe'], `seed ${seed}`).not.toContain(sampleTerrain(map, door.position));
      for (const shelf of map.shelves) {
        for (let x = shelf.x; x < shelf.x + shelf.width; x++) {
          for (const offset of [-2, -1, 1, 2]) {
            expect(['wall', 'shelf', 'pipe'], `seed ${seed}`).not.toContain(sampleTerrain(map, { x: x + 0.5, y: shelf.y + offset + 0.5 }));
          }
        }
      }
    }
  }, 30_000);
});

describe('terrain sampling and continuous paths', () => {
  it('samples floor coordinates and treats non-finite or out-of-map coordinates as walls', () => {
    const map = createSurvivalFixture(['#####', '#.~:#', '#=SP#', '#####']);
    expect(sampleTerrain(map, { x: 2.99, y: 1.01 })).toBe('mud');
    expect(sampleTerrain(map, { x: 3.5, y: 1.5 })).toBe('shadow');
    expect(sampleTerrain(map, { x: 1.5, y: 2.5 })).toBe('metal');
    for (const point of [{ x: -0.1, y: 0 }, { x: 5, y: 2 }, { x: NaN, y: 1 }, { x: 1, y: Infinity }]) {
      expect(sampleTerrain(map, point)).toBe('wall');
    }
  });

  it('routes around walls and shelves with exact continuous endpoints', () => {
    const map = createSurvivalFixture(['#######', '#..S..#', '#..#..#', '#.....#', '#######']);
    const from = { x: 1.2, y: 1.7 }, to = { x: 5.8, y: 1.1 };
    const path = findContinuousPath(map, from, to, 'hunter');
    expect(path[0]).toEqual(from);
    expect(path.at(-1)).toEqual(to);
    expect(path.some(point => point.y >= 3)).toBe(true);
    for (const point of path) expect(['wall', 'shelf']).not.toContain(sampleTerrain(map, point));
    for (const point of [{ x: -1, y: 1 }, { x: 3.1, y: 1.1 }]) {
      expect(findContinuousPath(map, point, to, 'runner')).toEqual([]);
    }
    expect(findContinuousPath(map, from, from, 'runner')).toEqual([from]);
    expect(findContinuousPath(map, from, { x: 1.8, y: 1.2 }, 'runner')).toEqual([from, { x: 1.8, y: 1.2 }]);
  });

  it('allows only runners to use paired pipes and flood-fills each actor independently', () => {
    const map = createSurvivalFixture(['#########', '#..P#P..#', '#########']);
    map.pipes = [{ id: 'P1', a: { x: 3.5, y: 1.5 }, b: { x: 5.5, y: 1.5 } }];
    const from = { x: 1.5, y: 1.5 }, to = { x: 7.5, y: 1.5 };
    map.runnerSpawns = [from]; map.hunterSpawn = from; map.futureZoneAnchors = [to];
    const path = findContinuousPath(map, from, to, 'runner');
    expect(path).toContainEqual(map.pipes[0]!.a);
    expect(path).toContainEqual(map.pipes[0]!.b);
    expect(findContinuousPath(map, from, to, 'hunter')).toEqual([]);
    const errors = validateSurvivalMap(map).errors;
    expect(errors.some(error => error.includes('runner disconnected'))).toBe(false);
    expect(errors.some(error => error.includes('hunter disconnected'))).toBe(true);
  });

  it('rejects sealed spawns, sealed future-zone anchors, invalid pipes and malformed grids', () => {
    const sealed = createSurvivalFixture(['#######', '#..#..#', '#..#..#', '#######']);
    sealed.runnerSpawns = [{ x: 1.5, y: 1.5 }, { x: 4.5, y: 1.5 }];
    sealed.futureZoneAnchors = [{ x: 4.5, y: 2.5 }];
    expect(validateSurvivalMap(sealed).errors).toEqual(expect.arrayContaining([
      expect.stringContaining('runner spawn 1'), expect.stringContaining('future-zone anchor 0'),
    ]));
    sealed.pipes = [{ id: 'bad', a: { x: 0.5, y: 0.5 }, b: { x: 4.5, y: 1.5 } }];
    expect(validateSurvivalMap(sealed).errors).toContain('invalid pipe bad');
    sealed.terrain.pop();
    expect(validateSurvivalMap(sealed).valid).toBe(false);
  });

  it('keeps pipe speed traversable and shelf speed blocked without changing existing motion', () => {
    const state = { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, heading: 0 };
    const control = { move: { x: 1, y: 0 }, desiredHeading: 0 };
    expect(integrateMotion(state, control, 'pipe', 1).velocity.x).toBe(RUNNER_SPEED);
    expect(integrateMotion(state, control, 'shelf', 1).velocity).toEqual({ x: 0, y: 0 });
  });
});

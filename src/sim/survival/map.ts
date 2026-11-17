import { Rng } from '../rng';
import { isTraversable, positionCell, reachableCells } from './pathing';
import type { TerrainKind, Vec2 } from './types';

export type Rect = { x: number; y: number; width: number; height: number };
export type SurvivalRoom = Rect & { id: string; moduleId: string; kind: 'small' | 'warehouse' | 'maintenance' | 'room' };
export type SurvivalDoor = {
  id: string; position: Vec2; kind: 'oneway' | 'security'; direction: Vec2; lockedUntil: number;
};
export type SurvivalMap = {
  seed: number;
  width: number;
  height: number;
  terrain: TerrainKind[];
  rooms: SurvivalRoom[];
  corridors: { from: string; to: string }[];
  shelves: Rect[];
  doors: SurvivalDoor[];
  pipes: { id: string; a: Vec2; b: Vec2 }[];
  runnerSpawns: Vec2[];
  hunterSpawn: Vec2;
  futureZoneAnchors: Vec2[];
};
export type ValidationResult = { valid: boolean; errors: string[] };

const WIDTH = 80, HEIGHT = 52;
const centre = (rect: Rect): Vec2 => ({ x: rect.x + Math.floor(rect.width / 2) + 0.5, y: rect.y + Math.floor(rect.height / 2) + 0.5 });

export function sampleTerrain(map: SurvivalMap, position: Vec2): TerrainKind {
  return map.terrain[positionCell(map, position)] ?? 'wall';
}

function carve(map: SurvivalMap, rect: Rect): void {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (x > 0 && y > 0 && x < map.width - 1 && y < map.height - 1) map.terrain[y * map.width + x] = 'floor';
    }
  }
}

function corridor(map: SurvivalMap, from: Vec2, to: Vec2, horizontalFirst: boolean): void {
  let x = Math.floor(from.x), y = Math.floor(from.y);
  const endX = Math.floor(to.x), endY = Math.floor(to.y);
  const step = () => carve(map, { x: x - 1, y: y - 1, width: 3, height: 3 });
  step();
  while (x !== endX || y !== endY) {
    if ((horizontalFirst && x !== endX) || y === endY) x += Math.sign(endX - x);
    else y += Math.sign(endY - y);
    step();
  }
}

/** BSP modules stay large enough for two independently sized small rooms and a shared hallway. */
function subdivide(rng: Rng, count: number): Rect[] {
  const leaves: Rect[] = [{ x: 1, y: 1, width: WIDTH - 2, height: HEIGHT - 2 }];
  while (leaves.length < count) {
    const candidates = leaves.filter(leaf => leaf.width >= 26 || leaf.height >= 22);
    candidates.sort((a, b) => b.width * b.height - a.width * a.height);
    const leaf = candidates[0];
    if (!leaf) break;
    const vertical = leaf.height < 22 || (leaf.width >= 26 && (leaf.width / leaf.height > 1.3 || rng.next() < 0.5));
    const length = vertical ? leaf.width : leaf.height, minimum = vertical ? 13 : 11;
    const cut = rng.int(Math.max(minimum, Math.floor(length * 0.4)), Math.min(length - minimum, Math.ceil(length * 0.6)));
    const a = { ...leaf, ...(vertical ? { width: cut } : { height: cut }) };
    const b = { ...leaf, ...(vertical ? { x: leaf.x + cut, width: length - cut } : { y: leaf.y + cut, height: length - cut }) };
    leaves.splice(leaves.indexOf(leaf), 1, a, b);
  }
  return leaves;
}

function makeRooms(rng: Rng, modules: Rect[]): SurvivalRoom[] {
  const rooms: SurvivalRoom[] = [];
  modules.forEach((module, index) => {
    const moduleId = `M${index}`;
    const append = (rect: Rect, kind: SurvivalRoom['kind']) => rooms.push({ ...rect, id: `R${rooms.length}`, moduleId, kind });
    if (index < 6) {
      const half = Math.floor(module.width / 2);
      for (let side = 0; side < 2; side++) {
        const width = rng.int(3, Math.min(6, (side === 0 ? half : module.width - half) - 2));
        const height = rng.int(3, 5);
        append({ x: module.x + (side === 0 ? 1 : half + 1), y: module.y + rng.int(1, module.height - height - 1), width, height }, 'small');
      }
    } else {
      const width = rng.int(7, Math.min(14, module.width - 2)), height = rng.int(7, Math.min(11, module.height - 2));
      append({ x: module.x + rng.int(1, module.width - width - 1), y: module.y + rng.int(1, module.height - height - 1), width, height }, index === modules.length - 1 ? 'warehouse' : index === 6 ? 'maintenance' : 'room');
    }
  });
  return rooms;
}

function repairConnectivity(map: SurvivalMap): void {
  // Repair arbitrary disconnected floor fragments without opening the solid outer border.
  let reached = reachableCells(map, map.hunterSpawn, 'hunter');
  for (let index = 0; index < map.terrain.length; index++) {
    if (isTraversable(map, index, 'hunter') && !reached.has(index)) {
      corridor(map, map.hunterSpawn, { x: index % map.width + 0.5, y: Math.floor(index / map.width) + 0.5 }, true);
      reached = reachableCells(map, map.hunterSpawn, 'hunter');
    }
  }
}

function placeShelves(map: SurvivalMap, reserved: Set<number>): void {
  for (const room of map.rooms.filter(room => room.kind === 'warehouse')) {
    for (let y = room.y + 2; y <= room.y + room.height - 3; y++) {
      const shelf = { x: room.x + 2, y, width: room.width - 4, height: 1 };
      const indices = Array.from({ length: shelf.width }, (_, offset) => y * map.width + shelf.x + offset);
      if (indices.some(index => reserved.has(index))) continue;
      indices.forEach(index => { map.terrain[index] = 'shelf'; });
      const count = map.terrain.filter(kind => kind !== 'wall' && kind !== 'shelf').length;
      if (reachableCells(map, map.hunterSpawn, 'hunter').size === count) {
        map.shelves.push(shelf);
        break;
      }
      indices.forEach(index => { map.terrain[index] = 'floor'; });
    }
  }
}

function placePipes(map: SurvivalMap, rng: Rng, reserved: Set<number>): void {
  // Keep pipe entrances out of aisles and anchors, and reject articulation cells for hunter access.
  const aisle = new Set<number>();
  for (const shelf of map.shelves) {
    for (let x = shelf.x; x < shelf.x + shelf.width; x++) {
      for (const dy of [-2, -1, 1, 2]) aisle.add((shelf.y + dy) * map.width + x);
    }
  }
  const candidates = rng.shuffle(map.terrain.flatMap((kind, index) => kind === 'floor' && !reserved.has(index) && !aisle.has(index) ? [index] : []));
  const entrances: Vec2[] = [];
  let walkableCount = map.terrain.filter(kind => kind !== 'wall' && kind !== 'shelf').length;
  for (const index of candidates) {
    map.terrain[index] = 'pipe';
    if (reachableCells(map, map.hunterSpawn, 'hunter').size !== walkableCount - 1) {
      map.terrain[index] = 'floor';
      continue;
    }
    walkableCount--;
    entrances.push({ x: index % map.width + 0.5, y: Math.floor(index / map.width) + 0.5 });
    if (entrances.length === 4) break;
  }
  for (let index = 0; index < entrances.length; index += 2) {
    map.pipes.push({ id: `P${index / 2}`, a: entrances[index]!, b: entrances[index + 1]! });
  }
}

function placeDoors(map: SurvivalMap, rng: Rng, reserved: Set<number>): void {
  const roomCells = new Set<number>();
  for (const room of map.rooms) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) roomCells.add(y * map.width + x);
    }
  }
  const protectedCells = new Set(reserved);
  for (const shelf of map.shelves) {
    for (let x = shelf.x; x < shelf.x + shelf.width; x++) {
      for (let dy = -2; dy <= 2; dy++) protectedCells.add((shelf.y + dy) * map.width + x);
    }
  }
  const candidates = rng.shuffle(map.terrain.flatMap((kind, index) => kind === 'floor' && !roomCells.has(index) && !protectedCells.has(index) ? [index] : []));
  for (const index of candidates) {
    const x = index % map.width, y = Math.floor(index / map.width);
    for (const direction of [{ x: 1, y: 0 }, { x: 0, y: 1 }]) {
      const across = { x: -direction.y, y: direction.x };
      const before = { x: x - direction.x + 0.5, y: y - direction.y + 0.5 };
      const after = { x: x + direction.x + 0.5, y: y + direction.y + 0.5 };
      if (sampleTerrain(map, before) !== 'floor' || sampleTerrain(map, after) !== 'floor') continue;
      const wall = Array.from({ length: 9 }, (_, offset) => ({ x: x + (offset - 4) * across.x, y: y + (offset - 4) * across.y }));
      if (wall.some(point => point.x < 1 || point.y < 1 || point.x >= map.width - 1 || point.y >= map.height - 1
        || roomCells.has(point.y * map.width + point.x) || protectedCells.has(point.y * map.width + point.x))) continue;
      const previous = wall.map(point => map.terrain[point.y * map.width + point.x]!);
      // A cross-wall creates a real single-cell corridor doorway. Check the closed geometry,
      // including previously placed doors, so the distant loop survives even simultaneous locks.
      wall.forEach(point => { map.terrain[point.y * map.width + point.x] = 'wall'; });
      map.doors.forEach(door => { map.terrain[positionCell(map, door.position)] = 'wall'; });
      const count = map.terrain.filter(kind => kind !== 'wall' && kind !== 'shelf').length;
      const connected = reachableCells(map, map.hunterSpawn, 'hunter').size === count;
      map.doors.forEach(door => { map.terrain[positionCell(map, door.position)] = 'floor'; });
      if (!connected) {
        wall.forEach((point, offset) => { map.terrain[point.y * map.width + point.x] = previous[offset]!; });
        continue;
      }
      map.terrain[index] = 'floor';
      map.doors.push({ id: `D${map.doors.length}`, position: { x: x + 0.5, y: y + 0.5 }, kind: map.doors.length === 0 ? 'oneway' : 'security', direction, lockedUntil: 0 });
      // Keep later entrances and doorframes out of this doorway's immediate neighbourhood.
      for (let yy = y - 4; yy <= y + 4; yy++) {
        for (let xx = x - 4; xx <= x + 4; xx++) {
          if (xx >= 0 && yy >= 0 && xx < map.width && yy < map.height) {
            reserved.add(yy * map.width + xx);
            protectedCells.add(yy * map.width + xx);
          }
        }
      }
      if (map.doors.length === 2) return;
      break;
    }
  }
  throw new Error(`unable to place two connected corridor doorways for seed ${map.seed}`);
}

export function generateSurvivalMap(seed: number): SurvivalMap {
  const rng = new Rng(seed);
  const rooms = makeRooms(rng, subdivide(rng, rng.int(8, 14)));
  const hunterSpawn = { x: 1.5, y: 2.5 };
  const map: SurvivalMap = {
    seed, width: WIDTH, height: HEIGHT, terrain: Array<TerrainKind>(WIDTH * HEIGHT).fill('wall'),
    rooms, corridors: [], shelves: [], doors: [], pipes: [], runnerSpawns: [], hunterSpawn, futureZoneAnchors: [],
  };
  rooms.forEach(room => carve(map, room));
  for (let index = 0; index < rooms.length; index++) {
    const from = rooms[index]!, to = rooms[(index + 1) % rooms.length]!;
    map.corridors.push({ from: from.id, to: to.id });
    corridor(map, centre(from), centre(to), rng.next() < 0.5);
  }
  // Extra cross-links make the ring useful even when two successive rooms share a BSP module.
  for (let index = 0; index < 3; index++) {
    const from = rooms[index]!, to = rooms[index + Math.floor(rooms.length / 2)]!;
    map.corridors.push({ from: from.id, to: to.id });
    corridor(map, centre(from), centre(to), index % 2 === 0);
  }
  carve(map, { x: 1, y: 1, width: 4, height: 4 });
  corridor(map, hunterSpawn, centre(rooms[0]!), true);
  repairConnectivity(map);
  // One spawn per module keeps all eight runners distributed across the facility.
  const moduleRooms = [...new Map(rooms.map(room => [room.moduleId, room])).values()];
  map.runnerSpawns = rng.shuffle(moduleRooms).slice(0, 8).map(centre);
  map.futureZoneAnchors = [...rooms].sort((a, b) => {
    const ca = centre(a), cb = centre(b);
    return Math.hypot(ca.x - WIDTH / 2, ca.y - HEIGHT / 2) - Math.hypot(cb.x - WIDTH / 2, cb.y - HEIGHT / 2);
  }).slice(0, 5).map(centre);
  const reserved = new Set([...map.runnerSpawns, hunterSpawn, ...map.futureZoneAnchors].map(point => positionCell(map, point)));
  placeShelves(map, reserved);
  // Doors start open; simulation/skills resolve directional passage and temporary locks.
  placeDoors(map, rng, reserved);
  placePipes(map, rng, reserved);
  for (const [index, kind] of (['shadow', 'mud', 'metal'] as const).entries()) {
    const room = rooms[index * 2]!;
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        const cell = y * WIDTH + x;
        if (map.terrain[cell] === 'floor') map.terrain[cell] = kind;
      }
    }
  }
  return map;
}

export function validateSurvivalMap(map: SurvivalMap): ValidationResult {
  const errors: string[] = [];
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width < 1 || map.height < 1
    || map.terrain.length !== map.width * map.height) return { valid: false, errors: ['invalid terrain dimensions'] };
  const kinds: TerrainKind[] = ['floor', 'wall', 'shadow', 'mud', 'metal', 'pipe', 'shelf'];
  if (map.terrain.some(kind => !kinds.includes(kind))) errors.push('unknown terrain kind');
  if (!map.runnerSpawns.length) errors.push('missing runner spawns');
  if (!map.futureZoneAnchors.length) errors.push('missing future-zone anchors');
  const pipeCells = new Set<number>();
  for (const pipe of map.pipes) {
    const a = positionCell(map, pipe.a), b = positionCell(map, pipe.b);
    if (a === b || sampleTerrain(map, pipe.a) !== 'pipe' || sampleTerrain(map, pipe.b) !== 'pipe'
      || pipeCells.has(a) || pipeCells.has(b)) errors.push(`invalid pipe ${pipe.id}`);
    pipeCells.add(a); pipeCells.add(b);
  }
  if (map.terrain.some((kind, index) => kind === 'pipe' && !pipeCells.has(index))) errors.push('unpaired pipe entrance');
  for (const actorKind of ['runner', 'hunter'] as const) {
    const start = actorKind === 'runner' ? map.runnerSpawns[0] : map.hunterSpawn;
    const reached = start ? reachableCells(map, start, actorKind) : new Set<number>();
    const count = map.terrain.filter((_, index) => isTraversable(map, index, actorKind)).length;
    if (count === 0 || reached.size !== count) errors.push(`${actorKind} disconnected terrain`);
    const anchors: [string, Vec2][] = [
      ...map.runnerSpawns.map((point, index): [string, Vec2] => [`runner spawn ${index}`, point]),
      ['hunter spawn', map.hunterSpawn],
      ...map.futureZoneAnchors.map((point, index): [string, Vec2] => [`future-zone anchor ${index}`, point]),
    ];
    for (const [label, point] of anchors) {
      if (!reached.has(positionCell(map, point))) errors.push(`${actorKind} unreachable ${label}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

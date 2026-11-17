import type { SurvivalActor, Vec2 } from './types';
import type { SurvivalMap } from './map';

export type ActorKind = SurvivalActor['kind'];

/** Continuous positions use cell corners as integer coordinates and cell centres at n + 0.5. */
export function positionCell(map: SurvivalMap, position: Vec2): number {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)
    || position.x < 0 || position.y < 0 || position.x >= map.width || position.y >= map.height) return -1;
  return Math.floor(position.y) * map.width + Math.floor(position.x);
}

export function isTraversable(map: SurvivalMap, index: number, actorKind: ActorKind): boolean {
  const terrain = map.terrain[index];
  return index >= 0 && index < map.width * map.height && terrain !== undefined
    && terrain !== 'wall' && terrain !== 'shelf' && (actorKind === 'runner' || terrain !== 'pipe');
}

function pipeLinks(map: SurvivalMap, actorKind: ActorKind): Map<number, number[]> {
  const links = new Map<number, number[]>();
  if (actorKind === 'hunter') return links;
  for (const pipe of map.pipes) {
    const a = positionCell(map, pipe.a), b = positionCell(map, pipe.b);
    if (map.terrain[a] !== 'pipe' || map.terrain[b] !== 'pipe') continue;
    links.set(a, [...(links.get(a) ?? []), b]);
    links.set(b, [...(links.get(b) ?? []), a]);
  }
  return links;
}

function adjacent(map: SurvivalMap, index: number, links: Map<number, number[]>): number[] {
  const x = index % map.width, y = Math.floor(index / map.width);
  const neighbours = [...(links.get(index) ?? [])];
  if (x > 0) neighbours.push(index - 1);
  if (x < map.width - 1) neighbours.push(index + 1);
  if (y > 0) neighbours.push(index - map.width);
  if (y < map.height - 1) neighbours.push(index + map.width);
  return neighbours;
}

function search(map: SurvivalMap, start: number, actorKind: ActorKind, goal = -1): Int32Array {
  const parent = new Int32Array(map.width * map.height).fill(-1);
  if (!isTraversable(map, start, actorKind)) return parent;
  const links = pipeLinks(map, actorKind);
  const queue = [start];
  parent[start] = start;
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    if (current === goal) break;
    for (const next of adjacent(map, current, links)) {
      if (parent[next] === -1 && isTraversable(map, next, actorKind)) {
        parent[next] = current;
        queue.push(next);
      }
    }
  }
  return parent;
}

export function reachableCells(map: SurvivalMap, from: Vec2, actorKind: ActorKind): Set<number> {
  const parent = search(map, positionCell(map, from), actorKind);
  const reached = new Set<number>();
  for (let index = 0; index < parent.length; index++) if (parent[index] !== -1) reached.add(index);
  return reached;
}

/** Orthogonal cell-centre waypoints preserve the exact endpoints and never cut obstacle corners.
 * A consecutive pair of pipe entrances denotes runner transit through that pipe, not a straight walk.
 */
export function findContinuousPath(map: SurvivalMap, from: Vec2, to: Vec2, actorKind: ActorKind): Vec2[] {
  const start = positionCell(map, from), goal = positionCell(map, to);
  if (!isTraversable(map, start, actorKind) || !isTraversable(map, goal, actorKind)) return [];
  if (start === goal) return from.x === to.x && from.y === to.y ? [{ ...from }] : [{ ...from }, { ...to }];
  const parent = search(map, start, actorKind, goal);
  if (parent[goal] === -1) return [];
  const cells = [goal];
  while (cells.at(-1) !== start) cells.push(parent[cells.at(-1)!]!);
  const centres = cells.reverse().map(index => ({ x: index % map.width + 0.5, y: Math.floor(index / map.width) + 0.5 }));
  const path = [{ ...from }];
  for (const point of [...centres, to]) {
    const previous = path.at(-1)!;
    if (point.x !== previous.x || point.y !== previous.y) path.push({ ...point });
  }
  return path;
}

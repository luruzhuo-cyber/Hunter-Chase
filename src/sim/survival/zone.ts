import { Rng } from '../rng';
import { positionCell, reachableCells } from './pathing';
import type { SurvivalMap } from './map';
import type { Vec2 } from './types';

export type ZonePolygon = { anchor: Vec2; vertices: Vec2[] };
export type ZonePhase = ZonePolygon & { index: number; warningTick: number; startTick: number; exposureRate: number };
export type ZoneSchedule = { dt: number; initial: ZonePolygon; phases: ZonePhase[] };
export type ZoneState = ZonePolygon & { phase: number; exposureRate: number; warning: boolean; nextShrinkTick?: number; next?: ZonePhase };

const EPSILON = 1e-9;
const cross = (a: Vec2, b: Vec2, c: Vec2): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Boundaries are safe, so a point does not flicker between exposure states on an edge. */
export function isInsideZone(position: Vec2, zone: ZonePolygon): boolean {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || zone.vertices.length < 3) return false;
  let inside = false;
  for (let i = 0, j = zone.vertices.length - 1; i < zone.vertices.length; j = i++) {
    const a = zone.vertices[j]!, b = zone.vertices[i]!;
    if (Math.abs(cross(a, b, position)) <= EPSILON
      && position.x >= Math.min(a.x, b.x) - EPSILON && position.x <= Math.max(a.x, b.x) + EPSILON
      && position.y >= Math.min(a.y, b.y) - EPSILON && position.y <= Math.max(a.y, b.y) + EPSILON) return true;
    if ((a.y > position.y) !== (b.y > position.y)
      && position.x < (b.x - a.x) * (position.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function convexHull(points: Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (vertices: Vec2[]): Vec2[] => {
    const hull: Vec2[] = [];
    for (const vertex of vertices) {
      while (hull.length >= 2 && cross(hull.at(-2)!, hull.at(-1)!, vertex) <= 0) hull.pop();
      hull.push(vertex);
    }
    return hull.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

export function createZoneSchedule(map: SurvivalMap, options: { dt?: number; phaseSeconds?: number } = {}): ZoneSchedule {
  const dt = options.dt ?? 0.1, phaseSeconds = options.phaseSeconds ?? 60;
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(phaseSeconds) || phaseSeconds < 30) throw new Error('invalid zone timing');
  const runnerReachable = reachableCells(map, map.runnerSpawns[0]!, 'runner');
  const hunterReachable = reachableCells(map, map.hunterSpawn, 'hunter');
  const anchors = map.futureZoneAnchors.filter(anchor => runnerReachable.has(positionCell(map, anchor)) && hunterReachable.has(positionCell(map, anchor)));
  if (!anchors.length) throw new Error('safe zones require a reachable anchor');
  const { width: w, height: h } = map;
  const initial: ZonePolygon = { anchor: { ...anchors[0]! }, vertices: [
    { x: 0, y: -h * 0.1 }, { x: w, y: -h * 0.1 }, { x: w * 1.1, y: 0 }, { x: w * 1.1, y: h },
    { x: w, y: h * 1.1 }, { x: 0, y: h * 1.1 }, { x: -w * 0.1, y: h }, { x: -w * 0.1, y: 0 },
  ] };
  const rng = new Rng(map.seed);
  const phases: ZonePhase[] = [];
  let previous = initial;
  for (let index = 1; index <= 5; index++) {
    const candidates = anchors.filter(anchor => isInsideZone(anchor, previous));
    const anchor = { ...rng.pick(candidates) };
    // Every vertex is a convex combination of a previous vertex and a validated anchor.
    // Taking their hull preserves nesting and a reachable safe point without changing terrain.
    const vertices = convexHull(previous.vertices.map(vertex => {
      const contraction = 0.67 + rng.next() * 0.08;
      return { x: anchor.x + (vertex.x - anchor.x) * contraction, y: anchor.y + (vertex.y - anchor.y) * contraction };
    }));
    const startTick = Math.ceil(index * phaseSeconds / dt);
    const phase: ZonePhase = { index, anchor, vertices, startTick, warningTick: startTick - Math.ceil(30 / dt), exposureRate: index * 2 };
    phases.push(phase);
    previous = phase;
  }
  return { dt, initial, phases };
}

export function zoneAtTick(schedule: ZoneSchedule, tick: number): ZoneState {
  let active: ZonePhase | undefined;
  let next: ZonePhase | undefined;
  for (const phase of schedule.phases) {
    if (tick >= phase.startTick) active = phase;
    else { next = phase; break; }
  }
  const polygon = active ?? schedule.initial;
  return { ...polygon, phase: active?.index ?? 0, exposureRate: active?.exposureRate ?? 0,
    warning: next !== undefined && tick >= next.warningTick, nextShrinkTick: next?.startTick, next };
}

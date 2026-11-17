import { add, clampMagnitude, length, normalize, scale } from './types';
import type { KinematicState, TerrainKind, Vec2 } from './types';

export type MotionControl = {
  move: Vec2;
  desiredHeading: number;
};

export const RUNNER_SPEED = 2.8;
export const RUNNER_ACCEL = 10;
export const RUNNER_TURN_RATE = 4;

export const TERRAIN_SPEED: Record<TerrainKind, number> = {
  floor: 1,
  mud: 0.55,
  shadow: 1,
  metal: 1,
  wall: 0,
  pipe: 1,
  shelf: 0,
};

function approachVec(current: Vec2, target: Vec2, maxDelta: number): Vec2 {
  const delta = { x: target.x - current.x, y: target.y - current.y };
  const distance = length(delta);
  if (distance <= maxDelta) return target;
  return add(current, scale(delta, maxDelta / distance));
}

function rotateToward(current: number, target: number, maxDelta: number): number {
  const fullTurn = Math.PI * 2;
  const delta = ((target - current + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
  const turn = Math.max(-maxDelta, Math.min(maxDelta, delta));
  return current + turn;
}

export function integrateMotion(
  state: KinematicState,
  control: MotionControl,
  terrain: TerrainKind,
  dt: number,
  speedMultiplier = 1,
): KinematicState {
  const elapsed = Math.max(0, dt);
  const maxSpeed = RUNNER_SPEED * TERRAIN_SPEED[terrain] * speedMultiplier;
  const targetVelocity = scale(normalize(control.move), maxSpeed);
  const velocity = clampMagnitude(
    approachVec(state.velocity, targetVelocity, RUNNER_ACCEL * elapsed),
    maxSpeed,
  );

  return {
    position: add(state.position, scale(velocity, elapsed)),
    velocity,
    heading: rotateToward(state.heading, control.desiredHeading, RUNNER_TURN_RATE * elapsed),
  };
}

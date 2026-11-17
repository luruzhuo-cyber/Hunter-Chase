import { describe, expect, it } from 'vitest';
import { integrateMotion, RUNNER_SPEED } from './motion';
import { length } from './types';

describe('survival motion', () => {
  it('accelerates smoothly without exceeding terrain speed', () => {
    const next = integrateMotion(
      { position: { x: 1, y: 1 }, velocity: { x: 0, y: 0 }, heading: 0 },
      { move: { x: 1, y: 0 }, desiredHeading: Math.PI / 2 },
      'floor',
      0.25,
    );

    expect(next.position.x).toBeGreaterThan(1);
    expect(length(next.velocity)).toBeLessThanOrEqual(RUNNER_SPEED);
    expect(next.heading).toBeGreaterThan(0);
    expect(next.heading).toBeLessThan(Math.PI / 2);
  });

  it('applies terrain speed limits while accelerating', () => {
    const next = integrateMotion(
      { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, heading: 0 },
      { move: { x: 1, y: 0 }, desiredHeading: 0 },
      'mud',
      10,
    );

    expect(length(next.velocity)).toBeLessThanOrEqual(RUNNER_SPEED * 0.55);
    expect(length(next.velocity)).toBeGreaterThan(0);
  });

  it('decelerates to a stop when there is no movement input', () => {
    const next = integrateMotion(
      { position: { x: 2, y: 3 }, velocity: { x: 1, y: 0 }, heading: 0 },
      { move: { x: 0, y: 0 }, desiredHeading: 0 },
      'floor',
      0.05,
    );

    expect(next.velocity.x).toBeGreaterThan(0);
    expect(next.velocity.x).toBeLessThan(1);
    expect(next.position.x).toBeGreaterThan(2);
  });
});

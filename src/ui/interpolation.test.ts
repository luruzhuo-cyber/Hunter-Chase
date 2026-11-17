import { describe, expect, it } from 'vitest';
import { interpolationAlpha } from './interpolation';

describe('interpolationAlpha', () => {
  it('uses the speed-scaled wall-clock interval', () => {
    expect(interpolationAlpha(25, 0, .1, 4)).toBe(1);
    expect(interpolationAlpha(12.5, 0, .1, 4)).toBe(.5);
    expect(interpolationAlpha(50, 0, .1, 2)).toBe(1);
  });
  it('clamps invalid or late samples safely', () => {
    expect(interpolationAlpha(-10, 0, .1, 1)).toBe(0);
    expect(interpolationAlpha(1000, 0, .1, 1)).toBe(1);
  });
});

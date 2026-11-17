import { describe, expect, it } from 'vitest';
import { runSurvivalBenchmark } from './survival-benchmark';

describe('survival benchmark', () => {
  it('is deterministic and reports every required balance field', () => {
    const first = runSurvivalBenchmark({ seeds: [1, 2, 3], maxTicks: 12 });
    const second = runSurvivalBenchmark({ seeds: [1, 2, 3], maxTicks: 12 });
    expect(second).toEqual(first);
    expect(first).toMatchObject({ episodeCount: 3, terminated: 3, repeatabilityMismatches: 0 });
    expect(first.runners).toHaveLength(8);
    expect(first.runners[0]).toEqual(expect.objectContaining({ id: '01', meanSurvivalSeconds: expect.any(Number), winRate: expect.any(Number), skillUseRate: expect.any(Number) }));
    expect(first).toEqual(expect.objectContaining({ timeoutRate: expect.any(Number), hunterClearRate: expect.any(Number) }));
  });
});

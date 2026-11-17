/** Maps wall-clock time to the fixed-step render interval at the selected playback rate. */
export function interpolationAlpha(now: number, snapshotAt: number, dt: number, playbackSpeed: number): number {
  if (![now, snapshotAt, dt, playbackSpeed].every(Number.isFinite) || dt <= 0 || playbackSpeed <= 0) return 1;
  return Math.min(1, Math.max(0, (now - snapshotAt) / (dt * 1000 / playbackSpeed)));
}

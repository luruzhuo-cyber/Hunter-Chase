import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSurvivalWorld, stepSurvivalWorld, type SurvivalActions, type SurvivalWorld } from '../src/sim/survival/world';

type Options = { seeds: number[]; maxTicks?: number; verifyRepeatability?: boolean; repeatabilityCount?: number };
type Episode = ReturnType<typeof runEpisode>;
const control = (world: SurvivalWorld): SurvivalActions => {
  const actions: SurvivalActions = {}, active = world.runners.filter(runner => runner.active);
  if (active.length) {
    const target = active.reduce((best, runner) => {
      const distance = Math.hypot(runner.kinematics.position.x - world.hunter.kinematics.position.x, runner.kinematics.position.y - world.hunter.kinematics.position.y);
      return distance < best.distance ? { runner, distance } : best;
    }, { runner: active[0]!, distance: Number.POSITIVE_INFINITY }).runner;
    actions.hunter = { move: { x: target.kinematics.position.x - world.hunter.kinematics.position.x, y: target.kinematics.position.y - world.hunter.kinematics.position.y } };
  }
  for (const runner of active) {
    const dx = runner.kinematics.position.x - world.hunter.kinematics.position.x, dy = runner.kinematics.position.y - world.hunter.kinematics.position.y;
    const jitter = ((world.seed + world.tick * 17 + Number(runner.id) * 31) % 9) - 4;
    actions[runner.id] = { move: { x: dx - dy * jitter * .08, y: dy + dx * jitter * .08 }, useSkill: !runner.skillUsed };
  }
  return actions;
};

function runEpisode(seed: number, maxTicks: number) {
  let world = createSurvivalWorld({ seed, maxTicks });
  const skillTick = new Map<string, number>();
  while (world.phase === 'running') {
    const actions = control(world);
    const next = stepSurvivalWorld(world, actions);
    for (const runner of next.runners) if (runner.skillUsed && !skillTick.has(runner.id)) skillTick.set(runner.id, next.tick);
    world = next;
  }
  return {
    seed,
    tick: world.tick,
    result: world.result!,
    hunterPose: world.hunter.kinematics,
    runners: world.runners.map(runner => ({
      id: runner.id,
      survivalSeconds: runner.survivalSeconds,
      active: runner.active,
      eliminationReason: runner.eliminationReason ?? null,
      skillUsed: runner.skillUsed,
      skillTick: skillTick.get(runner.id) ?? null,
      postSkillSurvivalSeconds: skillTick.has(runner.id) ? Math.max(0, runner.survivalSeconds - skillTick.get(runner.id)! * world.dt) : null,
      pose: runner.kinematics,
    })),
  };
}

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const signature = (episode: Episode) => JSON.stringify(episode);

export function runSurvivalBenchmark({ seeds, maxTicks = 3600, verifyRepeatability = true, repeatabilityCount = 10 }: Options) {
  if (!seeds.length) throw new Error('benchmark requires at least one seed');
  const episodes = seeds.map(seed => runEpisode(seed, maxTicks));
  let repeatabilityMismatches = 0;
  const repeatabilityChecked = verifyRepeatability ? Math.min(seeds.length, repeatabilityCount) : 0;
  for (let index = 0; index < repeatabilityChecked; index++) if (signature(runEpisode(seeds[index]!, maxTicks)) !== signature(episodes[index]!)) repeatabilityMismatches++;
  const runners = Array.from({ length: 8 }, (_, index) => {
    const id = String(index + 1).padStart(2, '0'), samples = episodes.map(ep => ep.runners[index]!);
    const used = samples.filter(sample => sample.skillUsed);
    return {
      id,
      meanSurvivalSeconds: mean(samples.map(sample => sample.survivalSeconds)),
      winRate: episodes.filter(ep => ep.result.winnerId === id).length / episodes.length,
      skillUseRate: used.length / samples.length,
      meanPostSkillSurvivalSeconds: used.length ? mean(used.map(sample => sample.postSkillSurvivalSeconds ?? 0)) : null,
      captures: samples.filter(sample => sample.eliminationReason === 'capture').length,
      exposureEliminations: samples.filter(sample => sample.eliminationReason === 'exposure').length,
    };
  });
  const clears = episodes.filter(ep => ep.result.reason === 'all-eliminated');
  return {
    schemaVersion: 1,
    policy: 'benchmark-scripted-stress-v1',
    episodeCount: episodes.length,
    terminated: episodes.filter(ep => ep.result !== undefined).length,
    repeatabilityChecked,
    repeatabilityMismatches,
    timeoutRate: episodes.filter(ep => ep.result.reason === 'timeout').length / episodes.length,
    hunterClearRate: clears.length / episodes.length,
    meanHunterClearSeconds: clears.length ? mean(clears.map(ep => ep.tick * 0.1)) : null,
    runners,
    episodeResults: episodes.map(episode => ({ seed: episode.seed, tick: episode.tick, winnerKind: episode.result.winnerKind,
      winnerId: episode.result.winnerId ?? null, reason: episode.result.reason })),
  };
}

function cli() {
  const args = process.argv.slice(2), countIndex = args.indexOf('--seeds'), outputIndex = args.indexOf('--output'), maxIndex = args.indexOf('--max-ticks');
  const count = countIndex >= 0 ? Number(args[countIndex + 1]) : 200;
  const maxTicks = maxIndex >= 0 ? Number(args[maxIndex + 1]) : 3600;
  if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(maxTicks) || maxTicks <= 0) throw new Error('--seeds and --max-ticks must be positive integers');
  const output = resolve(outputIndex >= 0 ? args[outputIndex + 1]! : 'artifacts/survival-benchmark-200.json');
  const result = runSurvivalBenchmark({ seeds: Array.from({ length: count }, (_, index) => index + 1), maxTicks });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ output, episodeCount: result.episodeCount, terminated: result.terminated, repeatabilityMismatches: result.repeatabilityMismatches, timeoutRate: result.timeoutRate, hunterClearRate: result.hunterClearRate, meanHunterClearSeconds: result.meanHunterClearSeconds, runners: result.runners }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) cli();

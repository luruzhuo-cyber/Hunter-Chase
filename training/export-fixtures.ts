import { mkdirSync, writeFileSync } from 'node:fs';
import { TrainingSession, CONTRACT } from './bridge';
const maps: Record<number, unknown> = {};
const cases = ['runner', 'hunter'].flatMap(side => [1701, 42].map(seed => {
  const session = new TrainingSession();
  const initial = session.request({ op: 'reset', side, seed, maxTicks: 8 });
  maps[seed] = structuredClone(session.world.map);
  const next = session.request({ op: 'step', action: 0 });
  return { side, seed, maxTicks: 8, mapHash: initial.info.map_hash, observation: initial.observation,
    mask: initial.mask, reward: next.info.reward_breakdown };
}));
mkdirSync(new URL('./tests/fixtures/', import.meta.url), { recursive: true });
writeFileSync(new URL('./tests/fixtures/contract-v1.json', import.meta.url), JSON.stringify({ contract: CONTRACT, maps, cases }, null, 2) + '\n');

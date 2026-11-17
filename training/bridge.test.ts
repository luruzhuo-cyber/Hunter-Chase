import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TrainingSession, CONTRACT } from './bridge';

const fixture = JSON.parse(readFileSync(new URL('./tests/fixtures/contract-v1.json', import.meta.url), 'utf8'));
test('versioned TS contract, complete fixture maps, observations, masks and rewards stay fixed', () => {
  assert.deepEqual(CONTRACT, fixture.contract);
  for (const sample of fixture.cases) {
    const session = new TrainingSession();
    const reset = session.request({ op: 'reset', side: sample.side, seed: sample.seed, maxTicks: sample.maxTicks });
    assert.deepEqual(session.world.map, fixture.maps?.[sample.seed], 'complete versioned map fixture');
    assert.deepEqual(reset.observation, sample.observation);
    assert.deepEqual(reset.mask, sample.mask);
    assert.equal(reset.info.map_hash, sample.mapHash);
    assert.deepEqual(session.request({ op: 'step', action: 0 }).info.reward_breakdown, sample.reward);
  }
});

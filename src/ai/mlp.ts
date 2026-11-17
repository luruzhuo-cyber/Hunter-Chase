import type { Rng } from '../sim/rng';
import type { PolicyModelV1 } from './model-format';
import { validatePolicyModel } from './model-format';

/** Pure TS dense inference and categorical sampling. No ambient random source. */
export function runPolicy(model: PolicyModelV1, observation: readonly number[], rng: Rng, legalMask?: readonly boolean[]) {
  validatePolicyModel(model);
  if (observation.length !== model.observationSize || !Array.from(observation).every(Number.isFinite)) throw new Error('invalid policy observation');
  const mask = legalMask ?? Array<boolean>(model.actionSize).fill(true);
  if (mask.length !== model.actionSize || !Array.from(mask).every(item => typeof item === 'boolean') || !mask.some(Boolean)) throw new Error('invalid policy action mask');
  let values = observation.map((value, i) => (value - model.normalization.mean[i]!) / model.normalization.std[i]!);
  if (!values.every(Number.isFinite)) throw new Error('nonfinite normalized observation');
  for (const layer of model.layers) {
    values = layer.weights.map((row, i) => {
      const sum = row.reduce((accumulator, weight, j) => accumulator + weight * values[j]!, layer.biases[i]!);
      if (!Number.isFinite(sum)) throw new Error('nonfinite policy inference');
      return layer.activation === 'relu' ? Math.max(0, sum) : layer.activation === 'tanh' ? Math.tanh(sum) : sum;
    });
  }
  const logits = values;
  const maximum = logits.reduce((best, logit, i) => mask[i] ? Math.max(best, logit) : best, -Infinity);
  const masses = logits.map((logit, i) => mask[i] ? Math.exp(logit - maximum) : 0);
  const total = masses.reduce((sum, value) => sum + value, 0);
  const probabilities = masses.map(value => value / total);
  const draw = rng.next();
  let cumulative = 0, actionIndex = mask.lastIndexOf(true);
  for (let i = 0; i < probabilities.length; i++) {
    cumulative += probabilities[i]!;
    if (draw < cumulative) { actionIndex = i; break; }
  }
  return { logits, probabilities, actionIndex };
}

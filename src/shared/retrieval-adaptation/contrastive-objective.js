import { retrievalTrainingMask } from './cohort.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_RETRIEVAL_ADAPTATION_OBJECTIVE' });
const objectives = new Set(['any-positive', 'mean-positive', 'graded-positive']);

/** Source-qualified, query-specific support for batches and cross-batch queues.
 * Scores are cosine values; unknown/conflicting/zero-weight pairs have no mass.
 * Negative weights enter the normalizer, never the positive target distribution.
 */
export const evaluateMaskedContrastiveObjective = ({ cohort, queryId, scores, objective, temperature }) => {
  if (!objectives.has(objective) || typeof temperature !== 'number' || !Number.isFinite(temperature)
    || temperature < 1e-6 || temperature > 1000 || !Array.isArray(scores) || scores.length > 1024) throw fail('A named objective, bounded temperature and bounded cosine support are required.');
  const byDocument = new Map();
  for (const row of scores) {
    if (!row || typeof row.documentId !== 'string' || typeof row.score !== 'number' || !Number.isFinite(row.score)
      || row.score < -1 || row.score > 1) throw fail('Finite cosine scores with explicit document IDs required.');
    if (byDocument.has(row.documentId) && byDocument.get(row.documentId) !== row.score) throw fail('Duplicate document IDs changed their score.');
    byDocument.set(row.documentId, row.score);
  }
  const support = retrievalTrainingMask(cohort, queryId, [...byDocument.keys()]);
  const positives = support.filter(row => row.mask && row.label === 'positive');
  const negatives = support.filter(row => row.mask && row.label === 'verified-negative' && row.weight > 0);
  const admitted = [...positives, ...negatives];
  const coverage = Object.freeze({ suppliedPairs: scores.length, uniquePairs: support.length, positivePairs: positives.length,
    negativePairs: negatives.length, zeroMaskedPairs: support.length - admitted.length });
  if (!positives.length || !negatives.length) return Object.freeze({ objective, temperature, loss: null, skipped: true,
    reason: !positives.length ? 'no-admitted-positive' : 'no-admitted-negative', coverage,
    gradients: Object.freeze(support.map(row => Object.freeze({ documentId: row.documentId, scoreGradient: 0, mask: row.mask }))) });
  // Center raw scores before temperature division and log-weight addition. This
  // retains small weight effects even when uncentered logits are very large.
  const maximum = Math.max(...admitted.map(row => byDocument.get(row.documentId)));
  const positiveMaximum = Math.max(...positives.map(row => byDocument.get(row.documentId)));
  const logit = row => (byDocument.get(row.documentId) - maximum) / temperature
    + (row.label === 'verified-negative' ? Math.log(row.weight) : 0);
  const centeredLogits = admitted.map(logit), logitMaximum = Math.max(...centeredLogits);
  const logSum = values => { const max = Math.max(...values); return max + Math.log(values.reduce((sum, value) => sum + Math.exp(value - max), 0)); };
  const logDenominator = logSum(centeredLogits);
  const positiveLogSum = logSum(positives.map(row => (byDocument.get(row.documentId) - positiveMaximum) / temperature));
  const targets = new Map(); let loss;
  if (objective === 'any-positive') {
    loss = (maximum - positiveMaximum) / temperature + logDenominator - positiveLogSum;
    for (const row of positives) targets.set(row.documentId, Math.exp((byDocument.get(row.documentId) - positiveMaximum) / temperature - positiveLogSum));
  } else {
    const masses = positives.map(row => objective === 'mean-positive' ? 1 : 2 ** row.grade - 1);
    const total = masses.reduce((sum, value) => sum + value, 0);
    if (!(total > 0) || !Number.isFinite(total)) throw fail('The declared positive grade map has zero or nonfinite mass.');
    loss = logDenominator;
    for (const [index, row] of positives.entries()) {
      const mass = masses[index] / total; targets.set(row.documentId, mass);
      loss += mass * ((maximum - byDocument.get(row.documentId)) / temperature);
    }
  }
  const probabilities = new Map(admitted.map((row, index) => [row.documentId,
    Math.exp(centeredLogits[index] - logitMaximum) / Math.exp(logDenominator - logitMaximum)]));
  const gradients = support.map(row => ({ documentId: row.documentId,
    scoreGradient: ((probabilities.get(row.documentId) ?? 0) - (targets.get(row.documentId) ?? 0)) / temperature, mask: row.mask }));
  if (!Number.isFinite(loss) || loss < -1e-10 || gradients.some(row => !Number.isFinite(row.scoreGradient))) throw fail('The masked objective produced invalid numerical work.');
  return Object.freeze({ objective, temperature, loss: Math.max(0, loss), skipped: false, reason: null, coverage,
    gradients: Object.freeze(gradients.map(Object.freeze)) });
};

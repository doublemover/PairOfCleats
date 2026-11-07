import assert from 'node:assert/strict';
import { retrievalTrainingFixture } from '../../helpers/retrieval-training-cohort.js';
import { compileRetrievalTrainingCohort } from '../../../src/shared/retrieval-adaptation/cohort.js';
import { evaluateMaskedContrastiveObjective } from '../../../src/shared/retrieval-adaptation/contrastive-objective.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/masked-contrastive-objective/')[1];
assert.ok(['named-objectives-and-independent-gradients', 'stable-temperature-and-masked-queues', 'missing-negative-skips-term'].includes(mode));
const cohort = compileRetrievalTrainingCohort(retrievalTrainingFixture().judgments), [query, other] = cohort.rows;
const positives = query.pairs.filter(row => row.label === 'positive'), negative = query.pairs.find(row => row.label === 'verified-negative');
const support = [...positives, negative];
const evaluate = (scores, objective = 'any-positive', temperature = 0.5) => evaluateMaskedContrastiveObjective({ cohort, queryId: query.queryId, scores, objective, temperature });
const scores = [{ documentId: positives[0].documentId, score: 0.8 }, { documentId: positives[1].documentId, score: -0.8 },
  { documentId: negative.documentId, score: 0.6 }];
if (mode === 'named-objectives-and-independent-gradients') {
  for (const objective of ['any-positive', 'mean-positive', 'graded-positive']) {
    const result = evaluate(scores, objective), logits = scores.map(row => Math.exp(row.score / 0.5)), denominator = logits.reduce((a, b) => a + b, 0);
    const masses = objective === 'graded-positive' ? positives.map(row => 2 ** row.grade - 1) : [1, 1];
    const expected = objective === 'any-positive' ? -Math.log((logits[0] + logits[1]) / denominator)
      : -masses.reduce((sum, mass, i) => sum + mass / (masses[0] + masses[1]) * Math.log(logits[i] / denominator), 0);
    assert.ok(Math.abs(result.loss - expected) < 1e-12);
    for (const row of scores) {
      const delta = 1e-6, altered = value => scores.map(otherRow => ({ ...otherRow, score: otherRow.documentId === row.documentId ? value : otherRow.score }));
      const numerical = (evaluate(altered(row.score + delta), objective).loss - evaluate(altered(row.score - delta), objective).loss) / (2 * delta);
      const gradient = result.gradients.find(entry => entry.documentId === row.documentId).scoreGradient;
      assert.ok(Math.abs(gradient - numerical) < 1e-7, `${objective}: independent finite difference`);
    }
    assert.equal(result.coverage.positivePairs, 2); assert.equal(result.coverage.negativePairs, 1);
  }
  const mean = evaluate(scores, 'mean-positive'), any = evaluate(scores, 'any-positive');
  assert.ok(mean.gradients.find(row => row.documentId === positives[0].documentId).scoreGradient > 0,
    'mean-positive can push down a dominant positive');
  assert.ok(any.gradients.find(row => row.documentId === positives[0].documentId).scoreGradient < 0);
} else if (mode === 'stable-temperature-and-masked-queues') {
  const hard = support.map(row => ({ documentId: row.documentId, score: row.label === 'positive' ? -1 : 1 }));
  const result = evaluate(hard, 'any-positive', 1e-6);
  assert.ok(Number.isFinite(result.loss)); assert.ok(Math.abs(result.loss - (2000000 - Math.log(2))) < 1e-8);
  assert.ok(result.gradients.every(row => Number.isFinite(row.scoreGradient)));
  const otherNegative = other.pairs.find(row => row.label === 'verified-negative').documentId;
  const unknown = query.pairs.find(row => row.label === 'unknown').documentId;
  const queued = evaluate([...scores, scores[0], { documentId: otherNegative, score: 1 }, { documentId: unknown, score: 1 }]);
  assert.equal(queued.loss, evaluate(scores).loss); assert.equal(queued.coverage.uniquePairs, 5);
  assert.equal(queued.gradients.find(row => row.documentId === otherNegative).scoreGradient, 0);
  assert.equal(queued.gradients.find(row => row.documentId === unknown).scoreGradient, 0);
  assert.throws(() => evaluate([...scores, { ...scores[0], score: 0.9 }]));
  assert.throws(() => evaluate(scores, 'inferred-objective'));
  assert.throws(() => evaluate(scores.map(row => ({ ...row, score: Infinity }))));
  const weightedFixture = retrievalTrainingFixture({ seeds: ['weighted'], alter({ packets }) { packets[0].judgments[2].weight = 1e-300; } });
  const weighted = compileRetrievalTrainingCohort(weightedFixture.judgments), row = weighted.rows[0];
  const near = evaluateMaskedContrastiveObjective({ cohort: weighted, queryId: row.queryId,
    scores: row.pairs.filter(pair => pair.mask).map(pair => ({ documentId: pair.documentId, score: 1 })), objective: 'any-positive', temperature: 1e-6 });
  assert.equal(near.skipped, false); assert.ok(Number.isFinite(near.loss)); assert.ok(near.loss >= 0);
} else {
  const positiveOnly = evaluate(scores.slice(0, 2)); assert.equal(positiveOnly.skipped, true);
  assert.equal(positiveOnly.loss, null); assert.equal(positiveOnly.reason, 'no-admitted-negative');
  assert.ok(positiveOnly.gradients.every(row => row.scoreGradient === 0));
  const negativeOnly = evaluate(scores.slice(2)); assert.equal(negativeOnly.reason, 'no-admitted-positive');
  assert.equal(evaluate([]).reason, 'no-admitted-positive');
}
console.log('Named masked objectives preserve independent gradients, stable normalizers and explicit skipped coverage.');

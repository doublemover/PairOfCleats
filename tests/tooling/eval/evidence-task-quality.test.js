import assert from 'node:assert/strict';
import { authoredEvidenceTask, evidenceTaskHash as hash } from '../../helpers/finite-evidence-task.js';
import { getOfflineEvaluationAdapter } from '../../../tools/eval/adapters.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/evidence-task-quality/')[1];
assert.ok(['owned-paired-metric-and-work', 'unknown-labels-and-incomplete-cohort', 'identity-and-cancellation'].includes(mode));
const adapter = await getOfflineEvaluationAdapter('finite-source-evidence-v1');
const make = () => ({ schemaVersion: 1, compilations: ['one', 'two', 'three'].map(seed => {
  const input = authoredEvidenceTask(seed); input.spec.problem = 'Select main and helper together, or select the alternative.'; return input;
}), splitPolicy: { schemaVersion: 1, seed: 'task-quality', train: 5000, dev: 2000, calibration: 1000, test: 2000 },
candidates: ['lexical-visible-prefix-v1', 'source-order-files-v1'].map(method => ({ schemaVersion: 1, method, runId: hash(method),
  maxReadBytes: 1048576, maxSelectedFiles: 1, maxSelectedSourceBytes: 1048576, maxWorkMs: 100 })) });
const request = () => ({ schemaVersion: 1, baselineMethod: 'lexical-visible-prefix-v1', candidateMethod: 'source-order-files-v1',
  seed: 'fixed-paired-family-replay', resamples: 64, limits: {} });
if (mode === 'owned-paired-metric-and-work') {
  const cohort = await adapter.runCohort(make()), result = await adapter.compareCohort({ cohort, request: request() });
  assert.equal(result.complete, true); assert.equal(result.statistics.complete, true);
  assert.equal(result.statistics.estimates.tasks, 3); assert.equal(result.statistics.estimates.completePairs, 3);
  assert.equal(result.statistics.estimates.clusters, 3); assert.equal(result.statistics.estimates.repositoryMacro.meanDifference, 1);
  assert.deepEqual(result.statistics.estimates.repositoryMacro.interval95, [1, 1]);
  assert.deepEqual(result.work.counts, { compilation: 3, split: 1, candidate: 6, scoring: 6 }, 'actual shared preparation is charged once while every score/candidate remains visible');
  assert.ok(result.work.candidateSourceBytesRead > 0); assert.equal(result.work.rssBytes, null); assert.equal(result.work.latencyInference, 'none');
  assert.equal(result.metricScope, 'finite-source-evidence-certificate-only'); assert.equal(result.currentSearchEvidence, false);
  assert.equal(result.policyQualification, 'not-established'); assert.equal(result.decision, null);
  const replayed = await adapter.compareCohort({ cohort, request: request() });
  assert.deepEqual(replayed.statistics.estimates, result.statistics.estimates, 'existing seeded paired owner determines the estimate');
  assert.notEqual(replayed.executionId, result.executionId);
} else if (mode === 'unknown-labels-and-incomplete-cohort') {
  const input = make(); input.compilations[0].privateOracle.validation.status = 'unverified';
  const cohort = await adapter.runCohort(input), result = await adapter.compareCohort({ cohort, request: request() });
  assert.equal(cohort.complete, true); assert.equal(result.statistics.estimates.tasks, 3); assert.equal(result.statistics.estimates.completePairs, 2);
  assert.equal(result.statistics.estimates.outcomes.baseline.missing, 1); assert.equal(result.statistics.estimates.outcomes.candidate.missing, 1);
  assert.equal(result.statistics.estimates.inference, 'conditional-on-complete-pairs');
  const invalid = make(); invalid.compilations[0].sourceSnapshot[0].availableAt = 1000;
  const refused = await adapter.compareCohort({ cohort: await adapter.runCohort(invalid), request: request() });
  assert.equal(refused.complete, false); assert.equal(refused.statistics, null); assert.equal(refused.population.quarantinedTasks, 1);
  assert.equal(refused.population.executionStatuses['invalid-fixture'], 2); assert.equal(refused.policyQualification, 'not-established');
  assert.equal(refused.reason, 'corpus-execution-or-report-incomplete');
} else {
  const cohort = await adapter.runCohort(make());
  await assert.rejects(adapter.compareCohort({ cohort: { ...cohort }, request: request() }), { code: 'ERR_EVIDENCE_TASK_COHORT_INPUT' });
  const same = request(); same.candidateMethod = same.baselineMethod;
  await assert.rejects(adapter.compareCohort({ cohort, request: same }), { code: 'ERR_EVIDENCE_TASK_QUALITY_INPUT' });
  const bounded = request(); bounded.limits.work = 1;
  const result = await adapter.compareCohort({ cohort, request: bounded });
  assert.equal(result.complete, false); assert.equal(result.statistics.estimates, null); assert.equal(result.reason, 'paired-quality-work');
  assert.equal(result.population.declaredRuns, 6, 'bounded comparison retains the original outcome denominator');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(adapter.compareCohort({ cohort, request: request() }, { signal: controller.signal }), { name: 'AbortError' });
}
console.log('Owned finite-task comparisons reuse paired family resampling while preserving missing labels and actual work identity.');

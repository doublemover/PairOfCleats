import assert from 'node:assert/strict';
import { finitePolicyQualificationFixture } from '../../helpers/finite-policy-qualification.js';
import { evidenceTaskHash as hash } from '../../helpers/finite-evidence-task.js';
import { freezeFinitePolicyQualification, evaluateFrozenFinitePolicy, qualifyFinitePolicy, validateFinitePolicyReceipt,
  invalidateFinitePolicyReceipt, readFinitePolicyEvaluation } from '../../../tools/eval/qualification/finite-source.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/finite-policy-qualification/')[1];
assert.ok(['original-outcomes-and-shadow-ceiling', 'concentrated-subgroup-failure', 'all-abstain-risk-undefined', 'unknown-label-denominators',
  'repeated-family-support', 'frozen-plan-and-source-identity', 'domain-expiry-and-invalidation', 'execution-failure-and-quarantine',
  'cancellation-consumes-original-plan'].includes(mode));
const run = async fixture => {
  const plan = freezeFinitePolicyQualification(fixture.spec), evaluation = await evaluateFrozenFinitePolicy(plan, fixture.input);
  return { plan, evaluation, receipt: qualifyFinitePolicy(evaluation) };
};
if (mode === 'original-outcomes-and-shadow-ceiling') {
  const fixture = finitePolicyQualificationFixture(), { evaluation, receipt } = await run(fixture);
  assert.equal(receipt.decision, 'shadow-only'); assert.equal(receipt.cohorts[0].metrics.answered, 3);
  assert.deepEqual(receipt.cohorts[0].metrics.riskBounds, [0, 0]); assert.deepEqual(receipt.cohorts[0].metrics.coverageBounds, [1, 1]);
  assert.equal(receipt.paired.knownMeanDifference, 1); assert.deepEqual(receipt.paired.interval95, [1, 1]);
  assert.equal(receipt.paired.interpretation, 'diagnostic-paired-quality; not-a-selective-risk-bound');
  assert.equal(receipt.activation, 'not-authorized-by-this-profile'); assert.equal(qualifyFinitePolicy(evaluation), receipt);
  const original = readFinitePolicyEvaluation(evaluation);
  assert.equal(original.cohort.executionId, receipt.cohortExecutionId); assert.equal(original.quality.executionId, receipt.qualityExecutionId);
  assert.equal(original.quality.work.counts.compilation, 3); assert.equal(original.quality.work.counts.split, 1);
  assert.equal(validateFinitePolicyReceipt(receipt, fixture.spec.domain, { now: 150 }).usable, true);
  assert.equal(validateFinitePolicyReceipt(receipt, fixture.spec.domain, { now: 150, purpose: 'activation' }).usable, false);
  assert.equal(validateFinitePolicyReceipt(JSON.parse(JSON.stringify(receipt)), fixture.spec.domain, { now: 150 }).status, 'unsupported');
  assert.throws(() => qualifyFinitePolicy({ ...evaluation }));
} else if (mode === 'concentrated-subgroup-failure') {
  const fixture = finitePolicyQualificationFixture({ count: 6, alter(input) {
    const oracle = input.compilations[5].privateOracle;
    oracle.alternatives = [{ id: 'non-alternative-source', groups: [{ id: 'main-or-helper', require: 1, unitIds: [oracle.units[0].id, oracle.units[2].id] }] }];
  } });
  fixture.spec.thresholds.maxRisk = 0.5; fixture.spec.minPairedQualityDifference = -1;
  fixture.spec.cohorts.push({ id: 'critical-subgroup', taskIndices: [5], thresholds: { ...fixture.spec.thresholds, minLeakageComponents: 1, maxRisk: 0, minUtility: 0 } });
  const { receipt } = await run(fixture);
  assert.ok(receipt.cohorts[0].metrics.riskBounds[1] < 0.5); assert.equal(receipt.decision, 'rejected');
  assert.deepEqual(receipt.cohorts[1].metrics.riskBounds, [1, 1]); assert.equal(receipt.cohorts[1].metrics.newlyIncorrect, 1);
  assert.ok(receipt.reasons.includes('critical-subgroup:selective-risk:rejected'));
} else if (mode === 'all-abstain-risk-undefined') {
  const fixture = finitePolicyQualificationFixture({ alter(input) { input.candidates[1].method = 'always-abstain-v1'; } });
  const { receipt } = await run(fixture), metrics = receipt.cohorts[0].metrics;
  assert.equal(metrics.answered, 0); assert.equal(metrics.abstained, 3); assert.equal(metrics.riskBounds, null);
  assert.deepEqual(metrics.coverageBounds, [0, 0]); assert.equal(receipt.decision, 'rejected');
  assert.ok(receipt.reasons.includes('all:coverage:rejected'));
} else if (mode === 'unknown-label-denominators') {
  const fixture = finitePolicyQualificationFixture({ alter(input) { input.compilations[0].privateOracle.validation.status = 'unverified'; } });
  fixture.spec.thresholds.maxRisk = 1;
  const { receipt } = await run(fixture), metrics = receipt.cohorts[0].metrics;
  assert.equal(receipt.decision, 'insufficient-evidence'); assert.equal(metrics.declaredTasks, 3); assert.equal(metrics.unknownLabels, 1);
  assert.equal(metrics.answered, 3); assert.deepEqual(metrics.riskBounds, [0, 1 / 3]); assert.deepEqual(metrics.utilityBounds, [2 / 3, 1]);
  assert.deepEqual(metrics.unconditionalFailureBounds, [0, 1 / 3]); assert.equal(receipt.paired.completePairs, 2);
} else if (mode === 'repeated-family-support') {
  const fixture = finitePolicyQualificationFixture({ count: 8, alter(input) {
    for (const task of input.compilations) task.lineage.repositoryFamilyId = hash('one-shared-family');
  } });
  const { receipt } = await run(fixture);
  assert.equal(receipt.cohorts[0].metrics.declaredTasks, 8); assert.equal(receipt.cohorts[0].metrics.leakageComponents, 1);
  assert.equal(receipt.paired.clusters, 1); assert.equal(receipt.paired.interval95, null); assert.equal(receipt.decision, 'insufficient-evidence');
} else if (mode === 'frozen-plan-and-source-identity') {
  const fixture = finitePolicyQualificationFixture(), originalId = fixture.spec.candidatePolicyId, plan = freezeFinitePolicyQualification(fixture.spec);
  fixture.spec.candidatePolicyId = hash('caller-mutated-policy');
  const pending = evaluateFrozenFinitePolicy(plan, fixture.input); fixture.input.compilations[0].spec.problem = 'caller-mutated-query';
  const evaluation = await pending, receipt = qualifyFinitePolicy(evaluation); assert.equal(receipt.spec.candidatePolicyId, originalId);
  await assert.rejects(evaluateFrozenFinitePolicy(plan, fixture.input), /unused original frozen/);
  const stale = finitePolicyQualificationFixture(), stalePlan = freezeFinitePolicyQualification(stale.spec);
  stale.input.compilations[0].sourceSnapshot[0].text += ' // changed';
  await assert.rejects(evaluateFrozenFinitePolicy(stalePlan, stale.input), /Frozen corpus/);
  const future = finitePolicyQualificationFixture(); future.spec.runtimeFeatures = 'gold-oracle-confidence-after-completion';
  assert.throws(() => freezeFinitePolicyQualification(future.spec));
  const unsupported = finitePolicyQualificationFixture(); unsupported.spec.thresholds.minCoverage = 0;
  assert.throws(() => freezeFinitePolicyQualification(unsupported.spec));
} else if (mode === 'domain-expiry-and-invalidation') {
  const fixture = finitePolicyQualificationFixture(), { receipt } = await run(fixture);
  for (const key of Object.keys(fixture.spec.domain)) {
    const domain = { ...fixture.spec.domain, [key]: hash('other-' + key) };
    const result = validateFinitePolicyReceipt(receipt, domain, { now: 150 }); assert.equal(result.status, 'stale');
    assert.deepEqual(result.reasons, ['domain-mismatch:' + key]);
  }
  for (const now of [99, 200]) assert.equal(validateFinitePolicyReceipt(receipt, fixture.spec.domain, { now }).status, 'stale');
  const prior = JSON.stringify(receipt), invalidation = invalidateFinitePolicyReceipt(receipt, { key: 'oracleId', newIdentity: hash('revised-oracle') });
  assert.equal(invalidation.status, 'stale'); assert.equal(JSON.stringify(receipt), prior);
  assert.equal(validateFinitePolicyReceipt(receipt, fixture.spec.domain, { now: 150 }).status, 'stale');
} else if (mode === 'execution-failure-and-quarantine') {
  const failed = finitePolicyQualificationFixture({ alter(input) { input.compilations[0].spec.allowedActions = ['search-visible-source']; } });
  const { receipt, evaluation } = await run(failed);
  assert.equal(evaluation.funnel.declaredRuns, 6); assert.equal(evaluation.funnel.executionStatuses['tool-error'], 1);
  assert.equal(receipt.cohorts[0].metrics.declaredTasks, 3); assert.equal(receipt.cohorts[0].metrics.unresolvedHarmPairs, 1);
  assert.equal(receipt.decision, 'insufficient-evidence'); assert.equal(receipt.paired.complete, false);
  const badSource = finitePolicyQualificationFixture({ alter(input) { input.compilations[0].sourceSnapshot[0].availableAt = 1000; } });
  const invalid = await run(badSource); assert.equal(invalid.receipt.decision, 'invalid');
  assert.equal(invalid.receipt.cohorts[0].metrics.declaredTasks, 3); assert.ok(invalid.receipt.cohorts[0].metrics.unknownActions > 0);
} else {
  const fixture = finitePolicyQualificationFixture(), plan = freezeFinitePolicyQualification(fixture.spec), controller = new AbortController();
  const pending = evaluateFrozenFinitePolicy(plan, fixture.input, { signal: controller.signal }); setImmediate(() => controller.abort(false));
  await assert.rejects(pending, { name: 'AbortError', cause: false });
  await assert.rejects(evaluateFrozenFinitePolicy(plan, fixture.input), /unused original frozen/);
  const bounded = finitePolicyQualificationFixture(), boundedPlan = freezeFinitePolicyQualification(bounded.spec);
  await assert.rejects(evaluateFrozenFinitePolicy(boundedPlan, bounded.input, { maxOutputBytes: 1024 }), { code: 'ERR_EVIDENCE_TASK_COHORT_OUTPUT' });
  await assert.rejects(evaluateFrozenFinitePolicy(boundedPlan, bounded.input), /unused original frozen/);
}
console.log('Independent finite policy receipts preserve subgroup risk, missing support, frozen identities and shadow-only scope.');

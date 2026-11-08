import { semanticHash } from '../../../src/index/semantic/identity.js';
import { captureSemanticRequest } from '../../../src/semantic/request-snapshot.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { captureFinitePolicyQualification } from '../../../src/contracts/validators/finite-policy-qualification.js';
import { EVIDENCE_TASK_COHORT_SCHEMA } from '../../../src/contracts/schemas/evidence-task-cohort.js';
import { EVIDENCE_TASK_SCHEMAS } from '../../../src/contracts/schemas/evidence-task.js';
import { assertEvidenceTask } from '../../../src/contracts/validators/evidence-task.js';
import { summarizeFinitePolicyCohort, finitePolicyMetricGates } from '../../../src/retrieval/evaluation/finite-policy-metrics.js';
import { evaluateEvidenceTaskCohort, evidenceTaskCohortInputIdentity, readEvidenceTaskCohort } from '../tasks/cohort.js';
import { compareEvidenceTaskCohort } from '../tasks/quality.js';

const plans = new WeakMap(), evaluations = new WeakMap(), receipts = new WeakMap();
const hash = (kind, value) => semanticHash('finite-policy-qualification.' + kind + '.v1', value, { maxBytes: 4 * 1024 * 1024 });
const fail = message => Object.assign(new Error(message), { code: 'ERR_FINITE_POLICY_QUALIFICATION' });
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
export const finiteEvidencePolicyIdentity = input => {
  input = captureSemanticRequest(input, EVIDENCE_TASK_SCHEMAS.baseline); assertEvidenceTask('baseline', input);
  const { runId: _run, ...policy } = input; return hash('registered-policy', policy);
};

/** First independent qualification profile: two fixed registered source-only
 * baselines, no fitting or predictor features. A source-pinned synthetic report
 * cannot acquire statistical or production activation eligibility here.
 */
export const freezeFinitePolicyQualification = input => {
  const spec = captureFinitePolicyQualification('spec', input);
  if (spec.baselinePolicyId === spec.candidatePolicyId || spec.qualityRequest.baselineMethod === spec.qualityRequest.candidateMethod
    || spec.notBefore >= spec.expiresAt || spec.cohorts.some(row => row.id === 'all')
    || new Set(spec.cohorts.map(row => row.id)).size !== spec.cohorts.length) throw fail('Distinct fixed policies, unique cohort names and a nonempty expiry domain required.');
  const handle = Object.freeze({ version: 1 }); plans.set(handle, { spec, specId: hash('spec', spec), used: false }); return handle;
};

export const evaluateFrozenFinitePolicy = async (handle, input, { signal = null, maxMs = 1000, maxOutputBytes = 1048576 } = {}) => {
  throwIfAborted(signal);
  const plan = handle && typeof handle === 'object' ? plans.get(handle) : null;
  if (!plan || plan.used) throw fail('One unused original frozen qualification plan required; retuning needs new exposure lineage.');
  input = captureSemanticRequest(input, EVIDENCE_TASK_COHORT_SCHEMA);
  const inputId = evidenceTaskCohortInputIdentity(input), { spec } = plan;
  const policies = new Map(input.candidates.map(row => [finiteEvidencePolicyIdentity(row), row]));
  const baseline = policies.get(spec.baselinePolicyId), candidate = policies.get(spec.candidatePolicyId);
  if (inputId !== spec.corpusInputId || !baseline || !candidate || input.candidates.length !== 2
    || baseline.method !== spec.qualityRequest.baselineMethod || candidate.method !== spec.qualityRequest.candidateMethod
    || input.splitPolicy.test !== 10000 || ['train', 'dev', 'calibration'].some(key => input.splitPolicy[key] !== 0)
    || spec.cohorts.some(row => row.taskIndices.some(index => index >= input.compilations.length))) throw fail('Frozen corpus, policies, complete test-only profile or cohort memberships changed.');
  // Consume before any candidate executes, including interrupted/failed runs.
  // This process-local plan is not an across-run exposure registry.
  plan.used = true;
  const cohort = await evaluateEvidenceTaskCohort(input, { signal, maxMs, maxOutputBytes });
  const quality = await compareEvidenceTaskCohort({ cohort, request: spec.qualityRequest }, { signal });
  throwIfAborted(signal);
  const original = readEvidenceTaskCohort(cohort);
  const evidenceId = hash('evidence', { specId: plan.specId, inputId, cohortExecutionId: cohort.executionId,
    qualityExecutionId: quality.executionId, qualityReportId: hash('paired-report', quality),
    scoringReceiptIds: original.runs.map(row => row.outcome?.receiptId ?? null) });
  const result = immutable({ schemaVersion: 1, kind: 'finite-policy-held-out-evaluation', specId: plan.specId,
    corpusInputId: inputId, evidenceId, cohortExecutionId: cohort.executionId, qualityExecutionId: quality.executionId,
    complete: cohort.complete && quality.complete, funnel: cohort.funnel, pairedQuality: quality,
    execution: 'actual-registered-finite-source-task-runner', statisticalRiskQualification: 'not-established' });
  evaluations.set(result, { plan, cohort, quality, original, baseline, candidate, receipt: null }); return result;
};

/** Retained original execution reports; no copied report grants qualification. */
export const readFinitePolicyEvaluation = result => {
  const state = result && typeof result === 'object' ? evaluations.get(result) : null;
  if (!state) throw fail('Original held-out evaluation required.');
  return Object.freeze({ cohort: state.cohort, quality: state.quality });
};

/** Independent deterministic checker reads original task outcomes. Missing and
 * incomplete rows remain in every relevant denominator. Bootstrap intervals are
 * retained only as paired-quality diagnostics, never selective-risk guarantees.
 */
export const qualifyFinitePolicy = result => {
  const state = result && typeof result === 'object' ? evaluations.get(result) : null;
  if (!state) throw fail('Original held-out evaluation required.');
  if (state.receipt) return state.receipt;
  const { spec, specId } = state.plan, { cohort, quality, original, candidate, baseline } = state;
  const rowsFor = method => new Map(original.runs.filter(row => row.method === method).map(row => [row.taskIndex, row]));
  const candidateRuns = rowsFor(candidate.method), baselineRuns = rowsFor(baseline.method);
  const assignments = new Map((cohort.splitManifest?.assignments ?? []).map(row => [row.compilationId, row]));
  const compilationIds = new Map(cohort.compilations.map(row => [row.index, row.compilationId]));
  const definitions = [{ id: 'all', taskIndices: Array.from({ length: cohort.funnel.suppliedTasks }, (_, i) => i), thresholds: spec.thresholds }, ...spec.cohorts];
  const cohorts = definitions.map(definition => {
    const metrics = summarizeFinitePolicyCohort({ indices: definition.taskIndices, candidateRuns, baselineRuns, assignments,
      compilationIds, readCeiling: candidate.maxReadBytes });
    return { id: definition.id, thresholds: definition.thresholds, metrics, gates: finitePolicyMetricGates(metrics, definition.thresholds) };
  });
  const estimate = quality.statistics?.estimates ?? null;
  const paired = { complete: quality.complete && quality.statistics?.complete === true,
    knownMeanDifference: estimate?.repositoryMacro.meanDifference ?? null, completePairs: estimate?.completePairs ?? 0,
    clusters: estimate?.clusters ?? 0, interval95: estimate?.repositoryMacro.interval95 ?? null,
    interpretation: 'diagnostic-paired-quality; not-a-selective-risk-bound' };
  const reasons = [];
  const invalid = cohort.funnel.invalidFixtures > 0 || cohort.funnel.quarantinedTasks > 0;
  if (invalid) reasons.push('invalid-or-quarantined-source-fixture');
  if (!cohort.complete) reasons.push('corpus-execution-or-report-incomplete');
  for (const row of cohorts) for (const gate of row.gates) if (gate.state !== 'pass') reasons.push(row.id + ':' + gate.id + ':' + gate.state);
  const rejected = cohorts.some(row => row.gates.some(gate => gate.state === 'rejected'))
    || paired.knownMeanDifference !== null && paired.knownMeanDifference < spec.minPairedQualityDifference;
  if (paired.knownMeanDifference !== null && paired.knownMeanDifference < spec.minPairedQualityDifference) reasons.push('paired-quality-point-difference-below-frozen-floor');
  if (!paired.complete || paired.knownMeanDifference === null) reasons.push('paired-quality-unavailable-or-incomplete');
  const insufficient = !cohort.complete || !paired.complete || paired.knownMeanDifference === null
    || cohorts.some(row => row.gates.some(gate => gate.state === 'insufficient-evidence'));
  const decision = invalid ? 'invalid' : rejected ? 'rejected' : insufficient ? 'insufficient-evidence' : 'shadow-only';
  if (decision === 'shadow-only') reasons.push('finite-source-profile-does-not-establish-sampling-risk-or-production-activation');
  const content = { schemaVersion: 1, kind: 'finite-source-policy-qualification', specId, spec,
    cohortExecutionId: cohort.executionId, qualityExecutionId: quality.executionId, decision, reasons, cohorts, paired,
    evidenceId: result.evidenceId, scope: 'authored-finite-source-task-results-only', activation: 'not-authorized-by-this-profile',
    exposureRegistry: 'original-plan-only; cross-run-lineage-not-qualified' };
  const receipt = captureFinitePolicyQualification('receipt', { ...content, receiptId: hash('receipt', content) });
  state.receipt = receipt; receipts.set(receipt, { state, invalidation: null }); return receipt;
};

export const validateFinitePolicyReceipt = (receipt, runtimeDomain, { now = Date.now(), purpose = 'shadow' } = {}) => {
  const owner = receipt && typeof receipt === 'object' ? receipts.get(receipt) : null;
  if (!owner) return immutable({ status: 'unsupported', usable: false, reasons: ['original-independent-checker-receipt-required'] });
  runtimeDomain = captureFinitePolicyQualification('domain', runtimeDomain);
  if (!Number.isSafeInteger(now) || now < 0 || !['shadow', 'activation'].includes(purpose)) throw fail('Exact shadow/activation purpose and bounded current time required.');
  const reasons = Object.keys(receipt.spec.domain).filter(key => runtimeDomain[key] !== receipt.spec.domain[key]).map(key => 'domain-mismatch:' + key);
  if (owner.invalidation) reasons.push('dependency-invalidated');
  if (now < receipt.spec.notBefore || now >= receipt.spec.expiresAt) reasons.push('outside-frozen-validity-window');
  if (reasons.length) return immutable({ status: 'stale', usable: false, reasons });
  if (receipt.decision !== 'shadow-only' || purpose === 'activation') return immutable({ status: 'unsupported', usable: false,
    reasons: [purpose === 'activation' ? 'finite-source-profile-never-authorizes-activation' : 'qualification-decision:' + receipt.decision] });
  return immutable({ status: 'usable-for-shadow', usable: true, reasons: [] });
};

/** New invalidation artifact; immutable observations are never overwritten.
 * Historical JSON alone cannot grant runtime admission through this profile.
 */
export const invalidateFinitePolicyReceipt = (receipt, { key, newIdentity }) => {
  const owner = receipt && typeof receipt === 'object' ? receipts.get(receipt) : null;
  if (!owner || typeof newIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(newIdentity)) throw fail('Original receipt and exact changed dependency identity required.');
  const expected = Object.hasOwn(receipt.spec.domain, key) ? receipt.spec.domain[key]
    : ['corpusInputId', 'baselinePolicyId', 'candidatePolicyId', 'fallbackId'].includes(key) ? receipt.spec[key] : null;
  if (!expected || expected === newIdentity) throw fail('A named dependency must actually change.');
  if (!owner.invalidation) owner.invalidation = immutable({ schemaVersion: 1, kind: 'finite-policy-invalidation',
    receiptId: receipt.receiptId, key, previousIdentity: expected, newIdentity, status: 'stale' });
  return owner.invalidation;
};

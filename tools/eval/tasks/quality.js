import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson, semanticHash } from '../../../src/index/semantic/identity.js';
import { captureSemanticRequest } from '../../../src/semantic/request-snapshot.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { EVIDENCE_TASK_SCHEMAS } from '../../../src/contracts/schemas/evidence-task.js';
import { assertEvidenceTask } from '../../../src/contracts/validators/evidence-task.js';
import { QUALITY_COMPARISON_VERSION } from '../../../src/contracts/schemas/quality-comparison.js';
import { comparePairedQuality } from '../../../src/retrieval/evaluation/paired-quality.js';
import { inspectEvidenceTaskOutcome } from '../../../src/retrieval/evaluation/tasks/score.js';
import { readEvidenceTaskCohort } from './cohort.js';

const hash = (kind, value) => semanticHash('finite-task-quality.' + kind + '.v1', value, { maxBytes: 1048576 });
const key = value => canonicalSemanticJson(value, { maxBytes: 1048576 });
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
const fail = message => Object.assign(new Error(message), { code: 'ERR_EVIDENCE_TASK_QUALITY_INPUT' });

/** Bounded work projection only. Original execution IDs deduplicate shared
 * preparation; this projection grants no native/resource retirement authority.
 */
const workLedger = (cohort, runs) => {
  const families = { compilation: new Map(), split: new Map(), candidate: new Map(), scoring: new Map() };
  const add = (family, value) => {
    if (!value) return;
    const previous = families[family].get(value.executionId);
    if (previous && key(previous) !== key(value)) throw fail('One original execution ID changed its reported work.');
    families[family].set(value.executionId, value);
  };
  for (const row of cohort.compilations) if (row.work) add('compilation', row.work);
  if (cohort.splitManifest) add('split', cohort.splitManifest.work);
  for (const row of runs) {
    if (row.artifact) add('candidate', row.artifact.work);
    if (row.outcome) {
      const receipt = inspectEvidenceTaskOutcome(row.outcome);
      add('compilation', receipt.work.compilation); add('split', receipt.work.split); add('scoring', receipt.work);
    }
  }
  return { counts: Object.fromEntries(Object.entries(families).map(([name, rows]) => [name, rows.size])),
    compilationReportedMs: [...families.compilation.values()].reduce((sum, row) => sum + row.elapsedMs, 0),
    splitReportedMs: [...families.split.values()].reduce((sum, row) => sum + row.elapsedMs, 0),
    candidateReportedMs: [...families.candidate.values()].reduce((sum, row) => sum + row.elapsedMs, 0),
    scoringBeforeEnvelopeReportedMs: [...families.scoring.values()].reduce((sum, row) => sum + row.scoringMs, 0),
    candidateSourceBytesRead: [...families.candidate.values()].reduce((sum, row) => sum + row.sourceBytesRead, 0),
    unmeasuredFailedCandidatePhases: runs.filter(row => row.executionStatus === 'tool-error' && !row.artifact).length,
    totalCohortMs: cohort.work.elapsedMs, accounting: 'each-original-execution-once; per-phase-sums-exclude-unreported-overhead',
    rssBytes: null, rssReason: 'not-measured', latencyInference: 'none' };
};

/** Use the existing paired/clustered owner for the exact named finite task
 * metric. Incomplete corpus admission cannot select a successful-only sample;
 * unknown task labels remain missing measurements, never implicit zeroes.
 */
export const compareEvidenceTaskCohort = async ({ cohort, request }, { signal = null } = {}) => {
  const began = performance.now(); throwIfAborted(signal);
  const original = readEvidenceTaskCohort(cohort);
  request = captureSemanticRequest(request, EVIDENCE_TASK_SCHEMAS.quality); assertEvidenceTask('quality', request);
  const baseline = original.policyBudgets.find(row => row.method === request.baselineMethod), candidate = original.policyBudgets.find(row => row.method === request.candidateMethod);
  if (!baseline || !candidate || baseline.method === candidate.method || baseline.budget !== candidate.budget) throw fail('Distinct original candidate methods with matched declared budgets required.');
  const work = workLedger(cohort, original.runs);
  const base = { schemaVersion: 1, kind: 'finite-task-cohort-quality', executionId: randomUUID(), cohortInputId: cohort.inputId,
    cohortExecutionId: cohort.executionId, baselineMethod: baseline.method, candidateMethod: candidate.method,
    population: cohort.funnel, metricScope: 'finite-source-evidence-certificate-only', currentSearchEvidence: false,
    policyQualification: 'not-established', generalization: { nearDuplicates: 'unchecked', trainingContamination: 'not-established',
      programOrModelTaskOutcomes: 'not-measured' }, work };
  if (!cohort.complete) return immutable({ ...base, complete: false, reason: 'corpus-execution-or-report-incomplete', statistics: null, decision: null });
  const assignments = new Map(cohort.splitManifest.assignments.map(row => [row.compilationId, row]));
  const metadata = new Map(original.metadata.map(row => [row.index, row]));
  const observations = method => original.runs.filter(row => row.method === method).map(row => {
    const receipt = inspectEvidenceTaskOutcome(row.outcome), assignment = assignments.get(receipt.taskSpecId), source = metadata.get(row.taskIndex);
    if (!assignment?.groupId || !source) throw fail('Outcome lost its original source/family split identity.');
    const known = receipt.executionStatus === 'completed' && ['pass', 'fail'].includes(receipt.taskResult);
    const status = known ? 'complete' : receipt.executionStatus === 'timeout' ? 'timeout' : receipt.executionStatus === 'canceled' ? 'cancelled'
      : ['invalid-fixture', 'tool-error'].includes(receipt.executionStatus) ? 'failed' : 'missing';
    return { taskKey: receipt.publicTaskId, inputKey: hash('input', { taskSpecId: receipt.taskSpecId, splitManifestId: receipt.splitManifestId,
      profile: receipt.taskOutcomeMeaning }), repoId: source.repositoryId, familyId: assignment.groupId, slice: 'finite-source-evidence', status,
    value: known ? receipt.taskResult === 'pass' ? 1 : 0 : null };
  });
  const left = observations(baseline.method), right = observations(candidate.method);
  const statistics = await comparePairedQuality({ schemaVersion: QUALITY_COMPARISON_VERSION, kind: 'paired-quality-comparison',
    metric: { name: 'finite-source-evidence-certificate', definitionKey: hash('metric', ['authored-source-interval-coverage-v1',
      'explicit-sufficient-alternatives-and-q-of-groups', 'unknown-labels-not-negatives', 'original-owned-outcomes']), unit: 'quality-unit-interval' },
    baselineKey: hash('baseline', { inputId: cohort.inputId, method: baseline.method, executionId: cohort.executionId }),
    candidateKey: hash('candidate', { inputId: cohort.inputId, method: candidate.method, executionId: cohort.executionId }),
    cluster: 'family', seed: request.seed, resamples: request.resamples, slices: [], baseline: left, candidate: right }, { signal, limits: request.limits });
  throwIfAborted(signal);
  const result = { ...base, complete: statistics.complete, reason: statistics.complete ? null : 'paired-quality-' + statistics.reason,
    statistics, decision: null, work: { ...work, comparisonElapsedMs: performance.now() - began, resampling: statistics.work ?? null } };
  if (Buffer.byteLength(JSON.stringify(result)) + 1 > 1048576) throw fail('Finite task quality report exceeds its response allowance.');
  return immutable(result);
};

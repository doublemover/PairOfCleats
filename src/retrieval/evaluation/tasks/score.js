import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson, semanticHash } from '../../../index/semantic/identity.js';
import { captureSemanticRequest } from '../../../semantic/request-snapshot.js';
import { isUtf16Boundary } from '../../../shared/embedded-content.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { EVIDENCE_TASK_SCHEMAS, EVIDENCE_TASK_VERSION } from '../../../contracts/schemas/evidence-task.js';
import { assertEvidenceTask } from '../../../contracts/validators/evidence-task.js';
import { inspectEvidenceTaskCompilation, readEvidenceTaskInputs, readEvidenceTaskCompiledSource } from './compiler.js';
import { evidenceTaskSplitMembership } from './splits.js';

const owned = new WeakMap();
const hash = (kind, value) => semanticHash('evidence-task.' + kind + '.v' + EVIDENCE_TASK_VERSION, value, { maxBytes: 262144 });
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
const fail = (suffix, message) => Object.assign(new Error(message), { code: 'ERR_EVIDENCE_TASK_' + suffix });
const union = spans => {
  const result = [];
  for (const span of spans.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const previous = result.at(-1);
    if (previous && previous[1] >= span[0]) previous[1] = Math.max(previous[1], span[1]); else result.push([...span]);
  } return result;
};

/** Read-only finite evidence-task execution: score the proposed source spans
 * against the private authored q-of/AND/OR oracle. This does not run a candidate
 * program or infer that a submitted span was actually read or used.
 */
export const scoreEvidenceTask = ({ task, manifest, submission }, { signal = null, maxBytes = 131072 } = {}) => {
  const began = performance.now(); throwIfAborted(signal);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 131072) throw new TypeError('Invalid evidence task outcome allowance.');
  const compilation = inspectEvidenceTaskCompilation(task), input = readEvidenceTaskInputs(task), membership = evidenceTaskSplitMembership(manifest, task);
  submission = captureSemanticRequest(submission, EVIDENCE_TASK_SCHEMAS.submission); assertEvidenceTask('submission', submission);
  canonicalSemanticJson(submission, { maxBytes: 262144 });
  if (submission.publicTaskId !== compilation.publicTaskId) throw fail('SCOPE', 'Submission belongs to another visible task.');
  if (submission.abstain && submission.evidence.length) throw fail('CONTRACT', 'An abstention cannot also assert evidence.');
  const rejected = [], selected = new Map(); let visitedSourceBytes = 0;
  for (const [index, ref] of submission.evidence.entries()) {
    throwIfAborted(signal);
    const file = readEvidenceTaskCompiledSource(task, ref.sourceUnitId);
    if (!file || ref.sourceHash !== file.ref.sourceHash || ref.path !== file.path || ref.span[1] < ref.span[0]
      || !isUtf16Boundary(file.text, ref.span[0]) || !isUtf16Boundary(file.text, ref.span[1])) {
      rejected.push({ index, reason: 'source-identity-or-original-utf16-span-mismatch' }); continue;
    }
    if (!selected.has(ref.sourceUnitId)) selected.set(ref.sourceUnitId, []); selected.get(ref.sourceUnitId).push(ref.span);
  }
  for (const [sourceUnitId, spans] of selected) {
    const merged = union(spans); selected.set(sourceUnitId, merged); const file = readEvidenceTaskCompiledSource(task, sourceUnitId);
    for (const [start, end] of merged) visitedSourceBytes += Buffer.byteLength(file.text.slice(start, end));
  }
  const coveredUnits = new Set();
  const analyze = submission.status === 'completed' && membership.state === 'frozen';
  for (const unit of analyze ? input.privateOracle.units : []) {
    if (selected.get(unit.source.sourceUnitId)?.some(([start, end]) => start <= unit.source.span[0] && end >= unit.source.span[1])) coveredUnits.add(unit.id);
  }
  const alternatives = (analyze ? input.privateOracle.alternatives : []).map(alternative => {
    const groups = alternative.groups.map(group => ({ id: group.id, required: group.require,
      coveredUnitIds: group.unitIds.filter(id => coveredUnits.has(id)).sort(order) }));
    return { id: alternative.id, groups, satisfied: groups.every(group => group.coveredUnitIds.length >= group.required),
      satisfiedGroups: groups.filter(group => group.coveredUnitIds.length >= group.required).length };
  }).sort((a, b) => Number(b.satisfied) - Number(a.satisfied) || b.satisfiedGroups - a.satisfiedGroups || order(a.id, b.id));
  const selectedAlternative = alternatives[0] ?? null, oracle = input.privateOracle;
  const withinBudget = visitedSourceBytes <= input.spec.limits.maxSelectedSourceBytes && submission.evidence.length <= input.spec.limits.maxEvidenceSpans;
  const sourceValidity = !rejected.length, oracleAdmitted = oracle.validation.status !== 'unverified';
  const { runId: _submissionRun, ...candidateContent } = submission;
  let executionStatus = submission.status, taskResult = 'unknown', reason = 'oracle-coverage-or-validation-unavailable';
  if (membership.state !== 'frozen') { executionStatus = 'invalid-fixture'; reason = 'quarantined-compiled-task'; }
  else if (submission.status !== 'completed') reason = 'candidate-submission-not-completed';
  else if (!sourceValidity || !withinBudget) { taskResult = 'fail'; reason = !sourceValidity ? 'invalid-source-evidence' : 'declared-evidence-budget-exceeded'; }
  else if (oracleAdmitted && oracle.noLocalAnswer === 'verified-in-supplied-model') { taskResult = submission.abstain ? 'pass' : 'fail'; reason = 'explicit-verified-empty-oracle'; }
  else if (oracleAdmitted && selectedAlternative?.satisfied && !submission.abstain) { taskResult = 'pass'; reason = 'one-explicit-sufficient-alternative-complete'; }
  else if (oracleAdmitted && oracle.labelCoverage === 'complete-in-declared-universe' && alternatives.length) { taskResult = 'fail'; reason = 'closed-declared-oracle-has-no-complete-alternative'; }
  const result = { schemaVersion: EVIDENCE_TASK_VERSION, kind: 'finite-evidence-task-outcome',
    taskSpecId: compilation.compilationId, publicTaskId: compilation.publicTaskId, splitManifestId: membership.manifestId,
    privateOracleId: compilation.privateOracleId, candidateId: submission.candidateId, runId: submission.runId,
    outputHash: hash('candidate-artifact', submission), candidateContentId: hash('candidate-content', candidateContent), executionStatus, taskResult, reason,
    taskOutcomeMeaning: 'finite-source-evidence-certificate-only', executedCandidateProgram: false,
    axes: { sourceValidity: sourceValidity ? 'matches-compiled-visible-snapshot' : 'invalid', labelCoverage: oracle.labelCoverage,
      evidenceGroups: selectedAlternative?.satisfied ? 'one-declared-alternative-complete' : 'incomplete-or-unknown',
      observedReadOrUse: 'not-established', semanticClosure: 'not-implied', downstreamOutcome: 'not-assessed' },
    evidence: { submittedSpans: submission.evidence.length, uniqueSourceUnits: selected.size, unionSourceBytes: visitedSourceBytes,
      analysisState: analyze ? 'declared-oracle-evaluated' : 'not-evaluated-incomplete-run-or-fixture',
      withinDeclaredBudget: withinBudget, rejected, coveredOracleUnits: coveredUnits.size,
      alternatives: alternatives.map(row => ({ id: row.id, satisfied: row.satisfied, requiredGroups: row.groups.length, satisfiedGroups: row.satisfiedGroups })),
      selectedAlternative, selection: 'one-complete-or-best-partial-declared-alternative' },
    qualification: { sourceAuthority: 'compiled-author-snapshot-not-live-reader', oracleAuthority: oracle.validation.status,
      oracleAdmission: 'supplied-status-and-receipt-ids-not-independently-revalidated',
      split: membership.split, nearDuplicateAudit: 'unchecked', trainingContamination: 'not-established' },
    work: { executionId: hash('score-execution', randomUUID()), compilation: compilation.work, split: manifest.work, scoringMs: performance.now() - began,
      setupAccounting: 'reference-original-execution-ids-once; fresh-score-work-every-call',
      rssBytes: null, rssReason: 'not-measured', buildOrModelExecution: 'not-requested' } };
  // The run label is consumed only as execution provenance. Exact proposed
  // content remains bound through candidateContentId; actual artifact/run data
  // stays in the separate execution receipt.
  const { work: _work, runId: _run, outputHash: _outputHash, ...semantic } = result;
  result.semanticOutcomeId = hash('outcome-semantics', semantic);
  result.receiptId = hash('outcome-receipt', { semanticOutcomeId: result.semanticOutcomeId,
    runId: result.runId, outputHash: result.outputHash, compilationExecutionId: compilation.work.executionId,
    splitExecutionId: manifest.work.executionId, scoringExecutionId: result.work.executionId });
  assertEvidenceTask('outcome', result);
  if (Buffer.byteLength(JSON.stringify(result)) + 1 > maxBytes) throw fail('OUTPUT_LIMIT', 'Finite evidence task outcome exceeds the response allowance.');
  throwIfAborted(signal); immutable(result); owned.set(result, { membership, compilationId: compilation.compilationId }); return result;
};
export const inspectEvidenceTaskOutcome = result => {
  if (!result || !owned.has(result)) throw fail('OUTCOME_HANDLE', 'Original finite evidence-task outcome required.'); return result;
};

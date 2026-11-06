import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { canonicalSemanticJson, semanticHash } from '../../../src/index/semantic/identity.js';
import { captureSemanticRequest } from '../../../src/semantic/request-snapshot.js';
import { throwIfAborted, isAbortError } from '../../../src/shared/abort.js';
import { EVIDENCE_TASK_COHORT_SCHEMA } from '../../../src/contracts/schemas/evidence-task-cohort.js';
import { assertEvidenceTaskCohort } from '../../../src/contracts/validators/evidence-task-cohort.js';
import { getOfflineEvaluationAdapter } from '../adapters.js';
import { evidenceBaselineCandidateId } from '../../../src/retrieval/evaluation/tasks/baseline.js';

const cohorts = new WeakMap();
const key = value => canonicalSemanticJson(value, { maxBytes: 8 * 1024 * 1024 });
const hash = value => semanticHash('finite-evidence-task.cohort.v1', value, { maxBytes: 8 * 1024 * 1024 });
const fail = message => Object.assign(new Error(message), { code: 'ERR_EVIDENCE_TASK_COHORT_INPUT' });
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
const knownTaskError = error => typeof error?.code === 'string' && error.code.startsWith('ERR_EVIDENCE_TASK_');
const errorData = error => ({ code: error.code, message: error.message });
const sameBudget = candidate => {
  const { method: _method, runId: _run, ...budget } = candidate; return key(budget);
};
const compilationSummary = report => ({ compilationId: report.compilationId, publicTaskId: report.publicTaskId,
  privateOracleId: report.privateOracleId, state: report.state, reasons: report.reasons.slice(0, 8).map(row => ({ reason: row.reason,
    path: row.path === null ? null : row.path.slice(0, 256) })), omittedReasons: Math.max(0, report.reasons.length - 8), work: report.work });

/** Closed read-only cohort execution, not a candidate-code runner. Compile and
 * split the whole admitted corpus before any candidate; reuse its one source
 * owner for matched-budget methods. Every declared task/method keeps an outcome.
 */
export const evaluateEvidenceTaskCohort = async (input, { signal = null, maxMs = 1000, maxOutputBytes = 131072 } = {}) => {
  const began = performance.now(); throwIfAborted(signal);
  if (!Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000 || !Number.isSafeInteger(maxOutputBytes)
    || maxOutputBytes < 1024 || maxOutputBytes > 1048576) throw new TypeError('Invalid finite task cohort work/output allowance.');
  input = captureSemanticRequest(input, EVIDENCE_TASK_COHORT_SCHEMA); assertEvidenceTaskCohort(input);
  const taskInputs = new WeakSet(input.compilations), taskInputIds = new WeakMap();
  const encodedHash = encoded => createHash('sha256').update('finite-evidence-task.cohort.v1\0').update(encoded).digest('hex');
  // Registered methods use runId only in their returned execution artifact,
  // never in scoring/selection. Preserve it in candidatePolicies/receipts while
  // keeping invocation labels out of the semantic corpus identity.
  const semanticInput = { ...input, candidates: input.candidates.map(({ runId: _run, ...candidate }) => candidate) };
  const encoded = canonicalSemanticJson(semanticInput, { maxBytes: 8 * 1024 * 1024, onObjectEncoded(value, text) {
    if (taskInputs.has(value)) taskInputIds.set(value, encodedHash(text));
  } });
  if (new Set(input.candidates.map(candidate => candidate.method)).size !== input.candidates.length
    || input.candidates.some(candidate => sameBudget(candidate) !== sameBudget(input.candidates[0]))) throw fail('Candidate methods must be distinct and have identical declared resource budgets.');
  const inputId = encodedHash(encoded), executionId = randomUUID(), adapter = await getOfflineEvaluationAdapter('finite-source-evidence-v1');
  const tasks = [], reports = [], outcomes = [], remaining = [], views = new Set(), runRecords = [];
  const taskRetirements = [], viewRetirements = [];
  let retiredTasks = 0;
  const retireView = view => { const receipt = adapter.dispose(view); views.delete(view); viewRetirements.push(receipt); };
  const retireOwners = () => {
    for (const view of [...views]) retireView(view);
    while (retiredTasks < tasks.length) { taskRetirements.push(adapter.disposeTask(tasks[retiredTasks].task)); retiredTasks++; }
  };
  const expired = () => performance.now() - began >= maxMs;
  let manifest = null, outputBytes = 8192;
  try {
    // Retain malformed semantic fixtures and unadmitted deadline rows, without
    // quietly selecting a successful-only corpus for split/quality claims.
    for (const [index, compilation] of input.compilations.entries()) {
      throwIfAborted(signal); const taskInputId = taskInputIds.get(compilation);
      if (expired()) { reports.push({ index, taskInputId, status: 'not-run', reason: 'cohort-work-budget' }); continue; }
      try {
        const task = adapter.compile(compilation, { signal }), report = adapter.inspectCompilation(task);
        tasks.push({ index, task, taskInputId, report }); reports.push({ index, taskInputId, status: 'compiled', ...compilationSummary(report) });
      } catch (error) {
        if (isAbortError(error) || !knownTaskError(error)) throw error;
        reports.push({ index, taskInputId, status: 'invalid-fixture', ...errorData(error) });
      }
      await yieldImmediate();
    }
    throwIfAborted(signal);
    if (tasks.length) manifest = adapter.assignSplits(tasks.map(row => row.task), input.splitPolicy, { signal });
    const skeleton = { inputId, executionId, reports, split: manifest, candidates: input.candidates };
    outputBytes += Buffer.byteLength(JSON.stringify(skeleton));
    if (outputBytes > maxOutputBytes) throw Object.assign(new Error('Finite task cohort metadata exceeds its output allowance.'), { code: 'ERR_EVIDENCE_TASK_COHORT_OUTPUT' });
    for (const report of reports) for (const candidate of input.candidates) {
      throwIfAborted(signal);
      const owner = tasks.find(row => row.index === report.index);
      let row;
      if (!owner) row = { taskIndex: report.index, taskInputId: report.taskInputId, method: candidate.method,
        executionStatus: report.status === 'invalid-fixture' ? 'invalid-fixture' : 'not-run', taskResult: 'unknown', reason: report.reason || report.message };
      else {
        const submission = status => ({ schemaVersion: 1, publicTaskId: owner.report.publicTaskId,
          candidateId: evidenceBaselineCandidateId(owner.report.publicTaskId, candidate), runId: candidate.runId,
          status, evidence: [], abstain: false });
        let artifact = null, error = null, outcome;
        if (owner.report.state === 'quarantined') outcome = adapter.score({ task: owner.task, manifest, submission: submission('not-run') }, { signal });
        else if (expired() || maxMs - (performance.now() - began) < candidate.maxWorkMs) outcome = adapter.score({ task: owner.task, manifest, submission: submission('not-run') }, { signal });
        else {
          let view = null;
          try {
            view = adapter.materialize({ task: owner.task, manifest }); views.add(view);
            artifact = adapter.runCandidate({ view, request: candidate }, { signal });
            outcome = adapter.score({ task: owner.task, manifest, submission: artifact.submission }, { signal });
          } catch (failure) {
            if (isAbortError(failure) || !knownTaskError(failure)) throw failure;
            error = errorData(failure); outcome = adapter.score({ task: owner.task, manifest, submission: submission('tool-error') }, { signal });
          } finally { if (view) retireView(view); }
        }
        row = { taskIndex: report.index, taskInputId: report.taskInputId, method: candidate.method, executionStatus: outcome.executionStatus,
          taskResult: outcome.taskResult, artifact, error, outcome };
      }
      runRecords.push(row);
      const bytes = Buffer.byteLength(JSON.stringify(row));
      if (outputBytes + bytes > maxOutputBytes) {
        remaining.push({ taskIndex: row.taskIndex, taskInputId: row.taskInputId, method: row.method,
          executionStatus: row.executionStatus, taskResult: 'unknown', reason: 'evaluated-result-exceeds-output-budget',
          scoringExecutionId: row.outcome?.work.executionId ?? null, candidateExecutionId: row.artifact?.work.executionId ?? null });
      } else { outputBytes += bytes; outcomes.push(row); }
      await yieldImmediate();
    }
    retireOwners();
    const counts = Object.fromEntries(['completed', 'invalid-fixture', 'not-run', 'timeout', 'canceled', 'tool-error'].map(status =>
      [status, runRecords.filter(row => row.executionStatus === status).length]));
    const result = { schemaVersion: 1, kind: 'finite-evidence-task-cohort', inputId, executionId,
      complete: !remaining.length && reports.every(row => row.status === 'compiled' && row.state !== 'quarantined')
        && runRecords.every(row => row.executionStatus === 'completed'),
      candidatePolicies: input.candidates, compilations: reports, splitManifest: manifest, outcomes, remaining,
      funnel: { suppliedTasks: input.compilations.length, compiledTasks: tasks.length, quarantinedTasks: reports.filter(row => row.state === 'quarantined').length,
        invalidFixtures: reports.filter(row => row.status === 'invalid-fixture').length, declaredRuns: input.compilations.length * input.candidates.length,
        executionStatuses: counts, pass: outcomes.filter(row => row.taskResult === 'pass').length,
        fail: outcomes.filter(row => row.taskResult === 'fail').length, unknown: outcomes.filter(row => row.taskResult === 'unknown').length + remaining.length },
      matchedSourcePool: tasks.length ? 'shared-original-compiled-task-per-admitted-pair' : null, matchedDeclaredBudgets: true, currentSearchEvidence: false,
      executedCandidateProgram: false, policyQualification: 'not-established', work: { elapsedMs: performance.now() - began } };
    result.retirement = { taskOwners: taskRetirements, candidateViews: viewRetirements, nativeResources: 'none' };
    if (Buffer.byteLength(JSON.stringify(result)) + 1 > maxOutputBytes) throw Object.assign(new Error('Finite task cohort report exceeds its output allowance.'), { code: 'ERR_EVIDENCE_TASK_COHORT_OUTPUT' });
    throwIfAborted(signal); immutable(result);
    const policyBudgets = input.candidates.map(candidate => ({ method: candidate.method, budget: sameBudget(candidate) }));
    cohorts.set(result, immutable({ policyBudgets, runs: runRecords, metadata: input.compilations.map((compilation, index) => ({ index,
      repositoryId: hash(compilation.spec.worldRef.repositoryNamespace), repositoryFamilyId: compilation.lineage.repositoryFamilyId })) }));
    return result;
  } catch (error) {
    // Our shared abort owner creates a data-property Error. Attach bounded
    // diagnostic progress to that original rejection; never reclassify a
    // coincident unrelated failure merely because the signal also changed.
    if (error && typeof error === 'object' && Object.getOwnPropertyDescriptor(error, 'code')?.value === 'ABORT_ERR'
      && Object.getOwnPropertyDescriptor(error, 'name')?.value === 'AbortError' && Object.isExtensible(error)) {
      retireOwners();
      const rows = input.compilations.flatMap((compilation, taskIndex) => input.candidates.map(candidate => {
        const previous = runRecords.find(row => row.taskIndex === taskIndex && row.method === candidate.method);
        const admission = reports.find(row => row.index === taskIndex);
        const invalidFixture = admission?.status === 'invalid-fixture' || admission?.state === 'quarantined';
        return { taskIndex, taskInputId: taskInputIds.get(compilation), method: candidate.method,
          executionStatus: previous?.executionStatus ?? (invalidFixture ? 'invalid-fixture' : 'canceled'), taskResult: previous?.taskResult ?? 'unknown',
          reason: previous?.error?.message ?? admission?.message ?? (invalidFixture ? 'quarantined-compiled-task' : 'caller-cancellation'),
          receiptId: previous?.outcome?.receiptId ?? null };
      }));
      const progress = { schemaVersion: 1, kind: 'finite-task-cohort-cancellation', inputId, executionId,
        complete: false, declaredRuns: rows.length, completedRuns: rows.filter(row => row.executionStatus === 'completed').length,
        canceledRemaining: rows.filter(row => row.executionStatus === 'canceled').length,
        invalidFixtureRuns: rows.filter(row => row.executionStatus === 'invalid-fixture').length, rows, omittedRows: 0,
        retiredTaskOwners: taskRetirements.length, retiredCandidateViews: viewRetirements.length, policyQualification: 'not-established' };
      while (progress.rows.length && Buffer.byteLength(JSON.stringify(progress)) + 1 > maxOutputBytes) { progress.rows.pop(); progress.omittedRows++; }
      Object.defineProperty(error, 'taskCohortPartial', { value: immutable(progress), enumerable: false });
    }
    throw error;
  } finally {
    retireOwners();
  }
};

export const readEvidenceTaskCohort = result => {
  const state = result && typeof result === 'object' ? cohorts.get(result) : null;
  if (!state) throw fail('Original finite evidence-task cohort required.'); return state;
};

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createSemanticContinuationBudget, isSemanticContinuationBudget } from '../../semantic/continuation-budget.js';
import { stageSemanticPagePublication } from '../../semantic/page-publication.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { throwIfAborted } from '../../shared/abort.js';
import { POSITIVE_RULE_REPAIR_VERSION, POSITIVE_RULE_REPAIR_SCHEMAS } from '../../contracts/schemas/positive-rule-repair.js';
import { assertPositiveRuleRepair } from '../../contracts/validators/positive-rule-repair.js';
import { describePositiveRuleRepair, positiveRuleRepairPreparation, POSITIVE_REPAIR_RETENTION_BYTES,
  replayPositiveRuleRepair, comparePositiveRepairScores } from './positive-repair.js';

const fail = (suffix, message) => Object.assign(new Error(message), { code: 'ERR_POSITIVE_RULE_REPAIR_' + suffix });
const retire = (entries, token) => () => entries.delete(token);
// Keep only the original bounded problem and private checked-prefix state.
const publish = (owner, token, entry, signal) => () => { throwIfAborted(signal); if (entry) owner.install(token, entry); };

/** Exhaustive finite subset search, paged under the shared semantic retention
 * owner. A partial search can return a fully replayed candidate without claiming
 * the unknown remainder is infeasible or that its incumbent is optimal.
 */
export const createPositiveRuleRepairService = ({ retentionBudget = null, maxContinuations = 32, ttlMs = 300000 } = {}) => {
  if (retentionBudget !== null && !isSemanticContinuationBudget(retentionBudget)) throw new TypeError('Original semantic continuation budget required.');
  if (!Number.isSafeInteger(maxContinuations) || maxContinuations < 1 || maxContinuations > 256
    || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 86400000) throw new TypeError('Invalid finite repair retention bounds.');
  retentionBudget ||= createSemanticContinuationBudget();
  const entries = new Map(); let disposed = false;
  const owner = { install(token, entry) {
    if (disposed) throw fail('CURSOR_EXPIRED', 'Repair service retired. Restart the pinned problem.');
    const expires = Date.now() + ttlMs;
    const lease = retentionBudget.retain(entry.bytes, expires, retire(entries, token));
    entries.set(token, { ...entry, expires, lease });
    while (entries.size > maxContinuations) entries.get(entries.keys().next().value).lease.release();
  } };
  const service = ({ problem, request, signal = null, deferPublication = false }) => {
    const began = performance.now(); throwIfAborted(signal);
    const description = describePositiveRuleRepair(problem);
    request = captureSemanticRequest(request, POSITIVE_RULE_REPAIR_SCHEMAS.page); assertPositiveRuleRepair('page', request);
    if (disposed) throw fail('CURSOR_EXPIRED', 'Repair service retired.');
    if (request.problemId !== problem.problemId) throw fail('BASE_MISMATCH', 'Repair page belongs to a different pinned problem.');
    retentionBudget.sweep();
    const saved = request.cursor ? entries.get(request.cursor) : null;
    if (request.cursor && (!saved || saved.problem !== problem || saved.expires <= Date.now())) throw fail('CURSOR_EXPIRED', 'Repair cursor expired or differs in problem, task, branch, constraints or owner.');
    const state = saved ? structuredClone(saved.state) : { nextMask: 0, feasible: 0, best: null,
      work: { replays: 0, ruleChecks: 0, bodyChecks: 0, directProducerRows: 0, emittedReplays: 0,
        emittedRuleChecks: 0, emittedBodyChecks: 0, emittedProducerRows: 0, searchElapsedMs: 0 } };
    const limits = { candidates: 64, workMs: 250, bytes: 131072, ...request.limits };
    let checkedThisPage = 0;
    while (state.nextMask < description.candidateCount && checkedThisPage < limits.candidates
      && (!checkedThisPage || performance.now() - began < limits.workMs)) {
      throwIfAborted(signal);
      const mask = state.nextMask;
      const revertEditIds = description.admissibleRevertIds.filter((_, index) => mask & (1 << index));
      const candidate = replayPositiveRuleRepair(problem, { problemId: problem.problemId, revertEditIds }, { signal });
      if (candidate.valid) {
        state.feasible++;
        if (!state.best || comparePositiveRepairScores(candidate, state.best) < 0) state.best = { revertEditIds: candidate.revertEditIds, score: candidate.score };
      }
      for (const field of ['ruleChecks', 'bodyChecks', 'directProducerRows']) state.work[field] += candidate.work[field];
      state.work.replays++; state.nextMask++; checkedThisPage++;
    }
    const complete = state.nextMask === description.candidateCount;
    // The emitted incumbent receives its own complete replay; it is not inferred
    // from a solver flag, a proof-height metric or the last Boolean delta.
    const candidate = state.best ? replayPositiveRuleRepair(problem, { problemId: problem.problemId, revertEditIds: state.best.revertEditIds }, { signal }) : null;
    if (candidate) {
      state.work.emittedReplays++; state.work.emittedRuleChecks += candidate.work.ruleChecks;
      state.work.emittedBodyChecks += candidate.work.bodyChecks; state.work.emittedProducerRows += candidate.work.directProducerRows;
    }
    state.work.searchElapsedMs += performance.now() - began;
    const result = { schemaVersion: POSITIVE_RULE_REPAIR_VERSION, kind: 'finite-positive-rule-repair-search', problemId: problem.problemId,
      baselineRootId: problem.baselineRootId, proposedRootId: description.proposedRootId, worldRef: description.worldRef, context: description.context,
      status: complete ? candidate ? 'optimal-in-declared-domain' : 'infeasible-in-declared-domain' : 'partial',
      candidate, objective: description.objective, candidateCount: description.candidateCount, checkedCandidates: state.nextMask,
      feasibleCandidates: state.feasible, frontier: { nextMask: state.nextMask, unexaminedCandidates: description.candidateCount - state.nextMask },
      optimality: complete ? 'complete-exhaustive-declared-reversion-domain' : 'unresolved',
      execution: 'none', programSemantics: 'not-established', cursor: complete ? null : randomUUID(),
      work: { ...state.work, checkedThisPage, preparation: positiveRuleRepairPreparation(problem), emittedReplay: candidate?.work ?? null,
        strategy: 'complete-forward-replay-per-subset; no-reverse-materialization-or-solver',
        elapsedMs: performance.now() - began, serializedByteUpperBound: 0, serializationElapsedMs: 0 } };
    const serializationBegan = performance.now();
    const bytes = Buffer.byteLength(JSON.stringify(result)) + 1;
    result.work.serializationElapsedMs = performance.now() - serializationBegan;
    // Fixed conservative headroom covers the two finalized numeric counters.
    result.work.serializedByteUpperBound = bytes + 128; result.work.elapsedMs = performance.now() - began;
    if (bytes + 128 > limits.bytes) throw fail('OUTPUT_LIMIT', 'Finite repair response exceeds its admitted byte allowance.');
    throwIfAborted(signal);
    return stageSemanticPagePublication(result, publish(owner, result.cursor,
      complete ? null : { problem, state, bytes: POSITIVE_REPAIR_RETENTION_BYTES + 16384 }, signal), deferPublication);
  };
  service.dispose = () => { disposed = true; for (const entry of [...entries.values()]) entry.lease.release(); };
  service.continuationStats = () => ({ cursors: entries.size, ...retentionBudget.stats() }); return service;
};

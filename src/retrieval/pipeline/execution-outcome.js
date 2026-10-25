import { RETRIEVAL_EXECUTION_VERSION, RETRIEVAL_EXECUTION_MODES, RETRIEVAL_EXECUTION_REASONS } from '../../contracts/retrieval-execution.js';

const route = value => typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null;
const budgetReasons = new Set(['deadline', 'attempt-limit', 'requested-hit-work-limit']);

/** Compact request-owned facts, independent of warning presentation and of
 * whether the returned hit array happens to be empty or nonempty.
 */
export const createRetrievalExecutionOutcome = ({ mode, requestedSparse = null, effectiveSparse = null,
  sparseFailed = false, annRequested = false, annMetrics = null, rerankerRequested = false,
  rerankerDiagnostic = null, graphMetrics = null, eligibleEmpty = false, unrecorded = false, chunkAuthorCoverage = null }) => {
  if (!RETRIEVAL_EXECUTION_MODES.includes(mode)) throw new TypeError('Invalid retrieval execution mode.');
  const reasons = new Set();
  if (unrecorded) reasons.add('outcome-unrecorded');
  if (chunkAuthorCoverage && chunkAuthorCoverage.state !== 'complete') reasons.add('chunk-author-unavailable');
  if (!eligibleEmpty) {
    if (sparseFailed) reasons.add('sparse-provider-failure');
    if (annRequested && annMetrics?.bypassedToSparse !== true) {
      if (annMetrics?.failedAttempts > 0 || annMetrics?.preflightFailures > 0 || annMetrics?.cooldownSkips > 0) reasons.add('ann-provider-failure');
      if (annMetrics?.providerAvailable !== true) reasons.add('ann-unavailable');
      if (budgetReasons.has(annMetrics?.countAware?.reasonEnded)) reasons.add('ann-budget');
    }
    if (graphMetrics?.truncated === true) reasons.add('graph-budget');
    if (rerankerDiagnostic?.status === 'fallback') reasons.add('reranker-fallback');
    if (rerankerDiagnostic?.pending === true) reasons.add('reranker-pending');
  }
  const selected = RETRIEVAL_EXECUTION_REASONS.filter(reason => reasons.has(reason));
  return Object.freeze({ schemaVersion: RETRIEVAL_EXECUTION_VERSION, kind: 'retrieval-mode-execution', mode,
    status: selected.length ? 'partial' : 'complete', cacheable: selected.length === 0,
    requested: Object.freeze({ sparse: route(requestedSparse), ann: annRequested === true, reranker: rerankerRequested === true }),
    effective: Object.freeze({ sparse: route(effectiveSparse), ann: route(annMetrics?.source), reranker: route(rerankerDiagnostic?.status) }),
    reasons: Object.freeze(selected) });
};

export const attachRetrievalExecution = (hits, outcome) => {
  Object.defineProperty(hits, 'executionOutcome', { value: outcome });
  return hits;
};

import { semanticAnalysisPolicyIdentity } from './analysis-versions.js';
import { throwIfAborted } from '../../shared/abort.js';
/** Reuse existing walk counts; unknown timing is not a measured zero. */
export const planSemanticSource = (policy, { sourceUnitId, sourceHash, syntaxPartitionId, metrics = {}, reuseReady = false }) => {
  const measured = metrics.sourceHash === sourceHash && Number.isFinite(metrics.analysisMs) && metrics.analysisMs >= 0;
  const observed = Number.isFinite(metrics.elapsedMs) && metrics.elapsedMs >= 0;
  const estimatedMs = measured ? metrics.analysisMs : null;
  const modes = {}, reasons = {};
  for (const phase of ['bindings', 'localFlow', 'crossFileFlow']) {
    const setting = policy.enrichment[phase];
    modes[phase] = setting === 'auto' ? policy.planning.inlineBudgetMs > 0 && (reuseReady || measured && estimatedMs <= policy.planning.inlineBudgetMs) ? 'eager' : 'deferred' : setting;
    if (policy.targetSelectionConfigured && !policy.targets.length) { modes[phase] = 'off'; reasons[phase] = policy.staleTargetCount ? 'target_source_hash_mismatch' : 'source_not_targeted'; continue; }
    reasons[phase] = setting !== 'auto' ? 'explicit_policy' : reuseReady ? 'compatible_tooling_reuse_ready' : measured ? modes[phase] === 'eager' ? 'measured_within_inline_budget' : 'measured_exceeds_inline_budget' : 'analysis_cost_measurement_unavailable';
  }
  return { sourceUnitId, sourceHash, syntaxPartitionId, matchingRuleIds: policy.matchingRuleIds || [], policyHash: policy.identity?.analysis || semanticAnalysisPolicyIdentity(policy), identity: policy.identity,
    metrics: { nodes: metrics.nodes || 0, operands: metrics.operands || 0, calls: metrics.calls || 0, observedMs: observed ? metrics.elapsedMs : null, estimatedMs, basis: measured ? 'measured-analysis' : 'reuse-existing-walk', analysisMeasured: measured }, readiness: reuseReady ? 'compatible-tooling-ready' : measured ? 'measured' : 'unknown', modes, reasons };
};
/** FIFO admission bounds active writer buffers; producer rows remain one awaited batch per producer. */
export const createSemanticByteAdmission = limit => {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('Semantic queued byte limit must be positive.');
  let used = 0; const pending = [];
  const drain = () => {
    while (pending.length && pending[0].bytes <= limit - used) {
      const item = pending.shift(); item.signal?.removeEventListener('abort', item.abort); used += item.bytes;
      let released = false;
      item.resolve(() => { if (released) return; released = true; used -= item.bytes; drain(); });
    }
  };
  return { get used() { return used; }, get pending() { return pending.length; }, acquire(bytes, { signal = null } = {}) {
    throwIfAborted(signal);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limit) throw Object.assign(new RangeError('Semantic batch exceeds queued-byte admission.'), { code: 'ERR_SEMANTIC_QUEUE_LIMIT' });
    return new Promise((resolve, reject) => {
      const item = { bytes, signal, resolve, reject, abort: null };
      item.abort = () => { const index = pending.indexOf(item); if (index >= 0) pending.splice(index, 1); try { throwIfAborted(signal); } catch (error) { reject(error); } drain(); };
      signal?.addEventListener('abort', item.abort, { once: true }); pending.push(item); drain();
    });
  } };
};
const sharedAdmissions = new WeakMap();
export const semanticByteAdmissionFor = (account, limit) => {
  if (!account || typeof account !== 'object') return createSemanticByteAdmission(limit);
  let admission = sharedAdmissions.get(account);
  if (!admission) { admission = createSemanticByteAdmission(limit); sharedAdmissions.set(account, admission); }
  return admission;
};

export const RETRIEVAL_EXECUTION_VERSION = 1;
export const RETRIEVAL_EXECUTION_MODES = Object.freeze(['code', 'prose', 'extracted-prose', 'records']);
export const RETRIEVAL_EXECUTION_REASONS = Object.freeze(['sparse-provider-failure', 'ann-provider-failure',
  'ann-unavailable', 'ann-budget', 'graph-budget', 'reranker-fallback', 'reranker-pending', 'outcome-unrecorded', 'chunk-author-unavailable']);

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const route = value => value === null || typeof value === 'string' && value.length > 0 && value.length <= 64;
const fields = (value, names) => record(value) && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name));
const envelopeFields = ['schemaVersion', 'kind', 'mode', 'status', 'cacheable', 'requested', 'effective', 'reasons'];
const requestedFields = ['sparse', 'ann', 'reranker'], effectiveFields = ['sparse', 'ann', 'reranker'];

/** Cache admission is about completed execution, not certified ANN recall. */
export const isRetrievalExecution = (value, mode) => fields(value, envelopeFields)
  && value.schemaVersion === RETRIEVAL_EXECUTION_VERSION && value.kind === 'retrieval-mode-execution'
  && RETRIEVAL_EXECUTION_MODES.includes(mode) && value.mode === mode
  && ['complete', 'partial'].includes(value.status) && value.cacheable === (value.status === 'complete')
  && Array.isArray(value.reasons) && value.reasons.length <= RETRIEVAL_EXECUTION_REASONS.length
  && value.reasons.every(reason => RETRIEVAL_EXECUTION_REASONS.includes(reason))
  && (value.reasons.length === 0 || new Set(value.reasons).size === value.reasons.length) && (value.reasons.length === 0) === value.cacheable
  && fields(value.requested, requestedFields) && route(value.requested.sparse) && typeof value.requested.ann === 'boolean'
  && typeof value.requested.reranker === 'boolean'
  && fields(value.effective, effectiveFields) && route(value.effective.sparse) && route(value.effective.ann) && route(value.effective.reranker);

export const isReusableRetrievalExecution = (value, mode) => isRetrievalExecution(value, mode) && value.cacheable;

export const areRetrievalExecutionsReusable = (byMode, requiredModes = null) => {
  if (!record(byMode)) return false;
  const modes = Object.keys(byMode);
  return modes.length > 0 && modes.length <= RETRIEVAL_EXECUTION_MODES.length
    && modes.every(mode => isReusableRetrievalExecution(byMode[mode], mode))
    && (!requiredModes || requiredModes.every(mode => Object.hasOwn(byMode, mode)));
};

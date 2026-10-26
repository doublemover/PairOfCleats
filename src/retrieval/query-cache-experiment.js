// Process-local diagnostic control. This changes result-cache lookup/persistence
// only; it is deliberately absent from CLI/config and ranking policy identity.
export const INTERNAL_QUERY_CACHE_BYPASS = Symbol('query-cache-experiment-bypass');

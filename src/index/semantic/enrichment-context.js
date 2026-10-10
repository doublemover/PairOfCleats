const grants = new WeakMap();
/** Internal in-process capability; command arguments cannot fabricate a drain authorization. */
export const createSemanticEnrichmentGrant = handlers => {
  const grant = Object.freeze({}); grants.set(grant, handlers); return grant;
};
export const attachSemanticEnrichmentRuntime = async (runtime, grant) => {
  if (grant === undefined || grant === null) return;
  const handlers = grants.get(grant);
  if (!handlers) throw Object.assign(new TypeError('Unrecognized manual enrichment authorization.'), { code: 'ERR_SEMANTIC_ENRICHMENT_AUTHORITY' });
  runtime.semanticEnrichmentDrain = await handlers.attach(runtime);
};

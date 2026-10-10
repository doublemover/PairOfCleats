/** Normalize once at build creation; structural policy never uses inference budgets. */
export const normalizeSemanticConfig = (value = {}) => ({
  schemaVersion: 1, enabled: value.enabled === true, profile: value.profile || 'balanced',
  languages: value.languages || ['javascript', 'typescript'],
  baseFacts: { structure: 'complete', sourceRetention: 'content-addressed', ...value.baseFacts },
  planning: { prepass: 'reuse-existing-walk', costModel: 'measured', inlineBudgetMs: 100, ...value.planning },
  enrichment: { bindings: 'auto', localFlow: 'auto', crossFileFlow: 'deferred',
    fieldPathDepth: value.profile === 'rich' ? 4 : 2, callContextDepth: value.profile === 'rich' ? 1 : 0,
    maxSccIterations: value.profile === 'rich' ? 12 : 8, unknownEffects: 'conservative', ...value.enrichment },
  execution: { deferredDrain: 'manual', afterIndexMaxMs: 30000, maxAttempts: 3, ...value.execution },
  storage: { batchRows: 4096, batchBytes: 1048576, maxQueuedBytes: 33554432,
    decodedCacheBytes: 67108864, targetPartBytes: 16777216, maxDiskWorkingSetBytes: 8589934592, ...value.storage },
  query: { maxRecords: 128, maxRows: 512, maxBytes: 65536, maxWorkMs: 250, maxContinuations: 64, cursorTtlMs: 300000, ...value.query },
  publication: { base: 'publish-with-coverage', semantic: 'whole-generation', ...value.publication }
});

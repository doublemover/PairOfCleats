const text = maxLength => ({ type: 'string', maxLength });
const nullable = maxLength => ({ anyOf: [text(maxLength), { type: 'null' }] });
const record = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });

/** Recorded retrieval facts only. Generations are provenance, not a live-worktree claim. */
export const SEARCH_DIAGNOSTICS_SCHEMA = record({
  schemaVersion: { const: 1 }, state: { enum: ['recorded', 'unknown'] }, summary: text(768),
  backend: record({ requested: nullable(128), selected: nullable(128), selectionReason: nullable(256),
    fidelity: { enum: ['complete', 'fallback-derived', 'unknown'] } }),
  reasons: { type: 'array', maxItems: 8, items: record({ code: nullable(64), message: nullable(512), next: nullable(512) }) },
  generations: { type: 'array', maxItems: 4, items: record({ mode: { enum: ['code', 'prose', 'extractedProse', 'records'] },
    buildId: nullable(256), generationKey: nullable(256), signature: nullable(256), profileId: nullable(256), artifactSurfaceVersion: nullable(256) }) },
  actions: { type: 'array', maxItems: 2, uniqueItems: true, items: { enum: ['index-report', 'tooling-doctor'] } },
  details: { type: 'array', maxItems: 24, items: text(768) }, truncated: { type: 'boolean' }
});

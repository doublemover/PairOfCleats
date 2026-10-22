const text = { type: 'string', minLength: 1, maxLength: 256 };
const list = (items, maxItems = 64) => ({ type: 'array', maxItems, uniqueItems: true, items });
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const positive = maximum => ({ type: 'integer', minimum: 1, maximum });
export const PROVIDER_FACT_FAMILIES = Object.freeze(['legacyTypes', 'symbolicTypes', 'bindings', 'definitions',
  'references', 'symbols', 'diagnostics', 'hierarchy']);
export const PROVIDER_CONSUMER_IDS = Object.freeze(['legacyRendering', 'typeFiltering', 'semanticDetail', 'semanticTrace', 'navigation']);
const requirement = object({ id: text, discovery: object({ strategy: { enum: ['command', 'path', 'module', 'file'] },
  candidates: { ...list(text, 32), minItems: 1 } }), verify: object({ versionRange: text, components: list(text) }),
provision: { oneOf: [object({ kind: { const: 'recipe' }, recipeId: text, supportedTargets: { ...list(text), minItems: 1 } }),
  object({ kind: { const: 'system-action' }, action: { type: 'string', minLength: 1, maxLength: 4096 } })] },
launch: object({ command: text, args: { ...list({ type: 'string', maxLength: 4096 }, 128), uniqueItems: false } }) });

/** Runtime schema is the sole provider declaration source; authoring and schema
 * export use this object rather than maintaining a second SDK representation. */
export const PROVIDER_DECLARATION_SCHEMA = object({
  schemaVersion: { const: 1 }, providerId: text, adapterVersion: text,
  execution: { enum: ['trusted-inprocess', 'lsp', 'jsonl', 'report'] },
  languages: { ...list(object({ id: text, dialect: { anyOf: [text, { type: 'null' }] } })), minItems: 1 },
  facts: { ...list(object({ family: { enum: PROVIDER_FACT_FAMILIES },
    evidence: { enum: ['presentation', 'source-qualified', 'provider-observation', 'exact-static'] } })), minItems: 1 },
  consumers: { ...list(object({ id: { enum: PROVIDER_CONSUMER_IDS }, families: { ...list({ enum: PROVIDER_FACT_FAMILIES }), minItems: 1 },
    partialPolicy: { enum: ['qualified', 'reject'] }, fallback: { enum: ['parser', 'legacy', 'unavailable'] } })), minItems: 1 },
  contextRequirements: list({ enum: ['source-snapshot', 'project-variant', 'observed-tool', 'dependency-closure', 'execution-grant'] }),
  limits: object({ maxRequests: positive(4096), maxFacts: positive(16384), maxBytes: positive(16 * 1024 * 1024), wallMs: positive(30000) }),
  prerequisites: list(requirement)
});

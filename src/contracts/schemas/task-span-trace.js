export const TASK_SPAN_TRACE_VERSION = 1;
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const record = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const ordinal = { type: 'integer', minimum: 0, maximum: 4096 };
const offset = { type: 'integer', minimum: 0, maximum: 32 * 1024 * 1024 };
const span = record({ sourceKey: hash, generation: hash, start: offset, end: offset, unit: { const: 'utf8-byte' } });
const stageState = { enum: ['complete', 'partial', 'unknown', 'omitted'] };
export const TASK_SPAN_TRACE_SCHEMA = record({ schemaVersion: { const: TASK_SPAN_TRACE_VERSION }, kind: { const: 'retrieval-task-span-trace' },
  identity: record({ taskKey: hash, inputKey: hash, runKey: hash, repoId: text(256), familyId: text(256), generation: hash, queryDigest: hash }),
  status: { enum: ['complete', 'failed', 'timeout', 'cancelled', 'incomplete'] },
  terminalSequence: ordinal, outcome: { enum: ['succeeded', 'failed', 'unknown'] },
  judgmentPolicyKey: hash,
  sources: { type: 'array', maxItems: 1024, items: record({ key: hash, repoId: text(256),
    mode: { enum: ['code', 'prose', 'extracted-prose', 'records'] }, file: text(4096), contentDigest: hash, generation: hash, byteLength: offset }) },
  stages: record({ retrieved: stageState, explored: stageState, delivered: stageState, used: stageState }),
  events: { type: 'array', maxItems: 4096, items: record({ id: text(128), sequence: ordinal,
    stage: { enum: ['retrieved', 'explored', 'delivered', 'used'] },
    adapter: { enum: ['cli', 'mcp', 'editor', 'saved-fixture'] }, status: { enum: ['observed', 'unknown', 'omitted'] },
    span: nullable(span), rank: nullable({ type: 'integer', minimum: 1, maximum: 4096 }),
    attribution: nullable({ enum: ['claim', 'edit-reference'] }), referenceId: nullable(text(128)) }) },
  gold: { type: 'array', maxItems: 4096, items: span },
  claims: { type: 'array', maxItems: 256, items: record({ id: text(128), statementDigest: hash,
    citations: { type: 'array', maxItems: 32, items: span },
    label: { enum: ['supported', 'contradicted', 'insufficient', 'unknown'] },
    judge: record({ kind: { enum: ['human', 'model', 'unjudged'] }, identityKey: nullable(hash) }) }) }
});

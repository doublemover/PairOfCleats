import { semanticObject as object, semanticHashSchema as hash, semanticNullable as nullable,
  SEMANTIC_GENERATION_SCHEMA } from './semantic-envelopes.js';
import { SEMANTIC_TASK_KINDS } from './semantic-task.js';
const text = { type: 'string', minLength: 1, maxLength: 4096 };
const taskId = { type: 'string', pattern: '^st1:[a-f0-9]{64}$' };
const list = (items, maxItems = 32) => ({ type: 'array', items, maxItems, uniqueItems: true });
export const SEMANTIC_ENRICHMENT_LIMITS_SCHEMA = object({
  maxTasks: { type: 'integer', minimum: 1, maximum: 32 }, maxBytes: { type: 'integer', minimum: 4096, maximum: 1048576 },
  maxMs: { type: 'integer', minimum: 1, maximum: 30000 }, drainMaxMs: { type: 'integer', minimum: 1, maximum: 600000 }
});
export const SEMANTIC_ENRICHMENT_REQUEST_SCHEMA = object({ schemaVersion: { const: 1 }, repoRoot: text,
  generation: SEMANTIC_GENERATION_SCHEMA }, { action: { enum: ['plan', 'enqueue', 'drain'], default: 'plan' },
  taskIds: list(taskId), limits: SEMANTIC_ENRICHMENT_LIMITS_SCHEMA });
const lineage = object({ sourceTaskId: taskId, replannedTaskId: taskId, inputHash: hash, policyHash: hash });
export const SEMANTIC_ENRICHMENT_RESULT_SCHEMA = object({ schemaVersion: { const: 1 }, requestId: hash,
  action: { enum: ['plan', 'enqueue', 'drain'] }, generation: SEMANTIC_GENERATION_SCHEMA,
  executionAuthorized: { type: 'boolean' }, status: { enum: ['planned', 'enqueued', 'published', 'recovered', 'blocked', 'unavailable', 'partial'] },
  tasks: list(object({ taskId, kind: { enum: SEMANTIC_TASK_KINDS }, baseBuildId: text, inputHash: hash,
    policyHash: hash, targetSetHash: hash, executable: { type: 'boolean' }, reason: nullable(text),
    state: { enum: ['not-inspected', 'pending', 'blocked', 'leased', 'completed', 'failed', 'cancelled', 'superseded'] } })),
  publishedGeneration: nullable(SEMANTIC_GENERATION_SCHEMA), lineage: list(lineage),
  supportedExecutors: list({ enum: SEMANTIC_TASK_KINDS }), diagnostics: list(text),
  validation: { const: 'implementation-unverified' }
});
export const SEMANTIC_ENRICHMENT_JOURNAL_SCHEMA = object({ schemaVersion: { const: 1 }, requestId: hash,
  sourceGeneration: SEMANTIC_GENERATION_SCHEMA, sourceManifestHash: hash, sourcePointerHash: hash,
  taskIds: list(taskId), status: { enum: ['prepared', 'building', 'published', 'reconciled', 'failed'] },
  lineage: list(lineage), publishedGeneration: nullable(SEMANTIC_GENERATION_SCHEMA),
  publishedManifestHash: nullable(hash), newBuildRoot: nullable(text), failure: nullable(text)
});
export const SEMANTIC_ENRICHMENT_SCHEMAS = { request: SEMANTIC_ENRICHMENT_REQUEST_SCHEMA,
  result: SEMANTIC_ENRICHMENT_RESULT_SCHEMA, journal: SEMANTIC_ENRICHMENT_JOURNAL_SCHEMA };

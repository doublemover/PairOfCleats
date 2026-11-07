import { semanticObject as object } from './semantic-envelopes.js';
import { TASK_SPAN_TRACE_SCHEMA } from './task-span-trace.js';
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const list = (items, maxItems, minItems = 0) => ({ type: 'array', items, maxItems, minItems, uniqueItems: true });
export const ORIGIN_OBSERVATION_SCHEMA = object({ schemaVersion: { const: 1 }, trace: TASK_SPAN_TRACE_SCHEMA,
  origins: list(object({ id: hash, dependenceGroupId: { anyOf: [hash, { type: 'null' }] },
    independence: { enum: ['declared-independent-with-assumptions', 'known-dependent', 'unknown'] }, assumptionIds: list(hash, 32) }), 1024),
  sourceBindings: list(object({ sourceKey: hash, originIds: list(hash, 8, 1),
    lineage: { enum: ['authored-origin', 'declared-quotation-lineage'] }, lineageReceiptId: hash }), 1024),
  edges: list(object({ id: hash, runKey: hash, fromEventId: text(128), toEventId: text(128),
    kind: { enum: ['observed-transfer', 'reported-parent', 'citation', 'hypothesis'] }, reporterId: text(256), receiptId: hash }), 4096) });

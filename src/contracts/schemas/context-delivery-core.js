import { semanticObject as object, semanticInteger as uint } from './semantic-envelopes.js';
import { QUESTION_WORLD_SCHEMA, QUESTION_SOURCE_REFERENCE_SCHEMA } from './repository-question.js';
import { ANSWER_QUESTION_REF_SCHEMA } from './answer-evidence.js';
import { SEMANTIC_RECORD_REF_SCHEMA } from './semantic.js';

export const CONTEXT_DELIVERY_VERSION = 1;
const version = { const: CONTEXT_DELIVERY_VERSION };
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const list = (items, maximum, minimum = 0) => ({ type: 'array', minItems: minimum, maxItems: maximum, items });
const hashes = maximum => ({ ...list(hash, maximum), uniqueItems: true });
const roles = { ...list(text(256), 64), uniqueItems: true };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
export const DELIVERY_CONTEXT_SCHEMA = object({ consumerId: text(256), sessionId: text(256), contextEpoch: uint, windowRevision: uint,
  taskRef: ANSWER_QUESTION_REF_SCHEMA, branchId: text(256), scopeDigest: hash, policyDigest: hash, worldRef: QUESTION_WORLD_SCHEMA });
export const DELIVERY_SOURCE_ENTRY_SCHEMA = object({ observationIds: { ...hashes(64), minItems: 1 },
  representation: { enum: ['exact-source', 'qualified-answer', 'synopsis', 'navigation'] }, source: nullable(QUESTION_SOURCE_REFERENCE_SCHEMA),
  roles, qualifiers: list(text(2048), 32), dependencyIds: hashes(128) });
const descriptor = object({ ...DELIVERY_SOURCE_ENTRY_SCHEMA.properties, id: hash, contentHash: hash, bodyBytes: uint });
const body = object({ id: hash, text: { type: 'string', maxLength: 131072 } });
const continuation = nullable(object({ producerId: text(256), requestDigest: hash, cursor: text(4096) }));
const limits = object({ packetBytes: { type: 'integer', minimum: 1024, maximum: 131072 },
  reconstructedBytes: { type: 'integer', minimum: 1024, maximum: 131072 } });
const request = object({ schemaVersion: version, contextRef: DELIVERY_CONTEXT_SCHEMA, expectedBaseDigest: nullable(hash),
  requiredExactSourceRoles: roles, unresolvedRoles: roles, continuation, limits });
const entry = object({ ...DELIVERY_SOURCE_ENTRY_SCHEMA.properties, text: body.properties.text });
const manifest = object({ schemaVersion: version, kind: { const: 'evidence-window-manifest' }, contextRef: DELIVERY_CONTEXT_SCHEMA,
  rendererId: { const: 'evidence-window-json-v1' }, tokenizerId: { type: 'null' }, entries: list(descriptor, 128),
  requiredExactSourceRoles: roles, unresolvedRoles: roles, continuation,
  cost: object({ renderedPackBytes: uint, fullPromptBytes: { type: 'null' }, fullPromptTokens: { type: 'null' } }), digest: hash });
const window = object({ schemaVersion: version, kind: { const: 'evidence-window' }, manifest, bodies: list(body, 128) });
const plan = object({ schemaVersion: version, kind: { const: 'evidence-delivery-plan' }, mode: { enum: ['full', 'delta'] },
  fallbackReason: nullable({ enum: ['UnknownBase', 'EpochMismatch', 'ScopeDenied', 'SourceStale', 'UnsupportedAdapter'] }),
  packetId: hash, baseDigest: nullable(hash), target: manifest, bodies: list(body, 128), limits,
  operations: object({ retain: hashes(128), add: hashes(128), removeFromWindow: hashes(128),
    invalidateCurrentUse: { anyOf: [hashes(128), { const: 'all-previous-window' }] } }),
  cost: object({ transmittedBytes: uint, reconstructedPackBytes: uint, fullPromptBytes: { type: 'null' }, fullPromptTokens: { type: 'null' } }) });
export const CONTEXT_DELIVERY_CORE_SCHEMAS = { request, entry, descriptor, manifest, window, plan,
  sourceRequest: object({ worldRef: QUESTION_WORLD_SCHEMA, partitionId: SEMANTIC_RECORD_REF_SCHEMA.properties.partitionId,
    sourceUnitId: QUESTION_SOURCE_REFERENCE_SCHEMA.properties.sourceUnitId, sourceHash: hash,
    maxBytes: { type: 'integer', minimum: 1, maximum: 1024 * 1024 } }),
  context: DELIVERY_CONTEXT_SCHEMA,
  receipt: object({ schemaVersion: version, kind: { const: 'evidence-window-receipt' }, packetId: hash, baseDigest: nullable(hash),
    targetDigest: hash, contextRef: DELIVERY_CONTEXT_SCHEMA, rendererId: { const: 'evidence-window-json-v1' },
    availability: { const: 'host-owned-pack-window' }, interpretation: { const: 'exact-reconstruction-not-comprehension-or-truth' },
    renderedPackBytes: uint, fullPromptBytes: { type: 'null' }, fullPromptTokens: { type: 'null' } }),
  binding: object({ consumerId: text(256), sessionId: text(256) }) };

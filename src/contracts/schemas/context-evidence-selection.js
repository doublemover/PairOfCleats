import { CONTEXT_EDIT_UNIT_SCHEMA } from './context-task.js';

const bounded = maximum => ({ type: 'integer', minimum: 0, maximum });
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const sourceHash = { type: 'string', pattern: '^(?:sha1:[a-f0-9]{40}|sha256:[a-f0-9]{64})$' };
const sourceIdentity = { type: 'object', additionalProperties: false,
  required: ['file', 'span', 'sourceHash', 'indexSignature', 'contentHash'], properties: {
    file: { type: 'string', minLength: 1 }, span: { type: 'array', minItems: 2, maxItems: 2, items: bounded(Number.MAX_SAFE_INTEGER) },
    sourceHash, indexSignature: { type: 'string', minLength: 1 }, contentHash: sourceHash } };
export const CONTEXT_EVIDENCE_SELECTOR_VERSION = 'evidence-set-v1';
export const CONTEXT_EVIDENCE_ROLE_VERSION = 'graph-incident-v1';
export const CONTEXT_EVIDENCE_SIMILARITY_VERSION = 'source-prefix-terms-v1';
export const CONTEXT_EVIDENCE_SELECTION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'algorithm'],
  properties: { schemaVersion: { const: 1 }, algorithm: { enum: ['top-k', 'mmr', 'role-coverage', 'facility-location'] },
    maxCandidates: bounded(64), maxSelected: bounded(16), maxPairwise: bounded(4096),
    maxWorkUnits: bounded(262144), maxWallClockMs: bounded(10000), maxPoolBytes: bounded(524288),
    maxMeasurements: { type: 'integer', minimum: 1, maximum: 128 }, lambda: { type: 'number', minimum: 0, maximum: 1 } }
};
const role = { enum: ['call', 'usage', 'export', 'import'] };
const ref = { oneOf: [
  { type: 'object', additionalProperties: false, required: ['type', 'chunkUid'],
    properties: { type: { const: 'chunk' }, chunkUid: { type: 'string', minLength: 1 } } },
  { type: 'object', additionalProperties: false, required: ['type', 'symbolId'],
    properties: { type: { const: 'symbol' }, symbolId: { type: 'string', minLength: 1 } } },
  { type: 'object', additionalProperties: false, required: ['type', 'path'],
    properties: { type: { const: 'file' }, path: { type: 'string', minLength: 1 } } },
  { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: 'unqualified' } } }
] };
export const CONTEXT_SELECTED_EVIDENCE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['id', 'unitId', 'ref', 'file', 'excerpt', 'unit', 'evidence', 'roles'],
  properties: { id: digest, unitId: digest, ref,
    file: { type: 'string' }, excerpt: { type: 'string' }, unit: CONTEXT_EDIT_UNIT_SCHEMA,
    evidence: { type: 'object', additionalProperties: true }, roles: { type: 'array', maxItems: 4, uniqueItems: true, items: role } }
};
export const CONTEXT_EVIDENCE_SET_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'selectorVersion', 'roleVersion', 'similarityVersion', 'policy', 'policyDigest', 'poolDigest',
    'partial', 'stopReason', 'selected', 'decisions', 'coverage', 'similarity', 'stats'],
  properties: { schemaVersion: { const: 1 }, selectorVersion: { const: CONTEXT_EVIDENCE_SELECTOR_VERSION },
    roleVersion: { const: CONTEXT_EVIDENCE_ROLE_VERSION }, similarityVersion: { const: CONTEXT_EVIDENCE_SIMILARITY_VERSION },
    policy: { ...CONTEXT_EVIDENCE_SELECTION_SCHEMA, required: Object.keys(CONTEXT_EVIDENCE_SELECTION_SCHEMA.properties) }, policyDigest: digest, poolDigest: digest,
    partial: { type: 'boolean' }, stopReason: { type: ['string', 'null'] },
    similarity: { type: 'object', additionalProperties: false, required: ['meaning', 'maxChars', 'maxTerms', 'emptyIds', 'unavailableIds'],
      properties: { meaning: { const: 'lexical-prefix-jaccard' }, maxChars: { const: 4096 }, maxTerms: { const: 128 },
        emptyIds: { type: 'array', maxItems: 64, uniqueItems: true, items: digest },
        unavailableIds: { type: 'array', maxItems: 64, uniqueItems: true, items: digest } } },
    selected: { type: 'array', maxItems: 16, items: CONTEXT_SELECTED_EVIDENCE_SCHEMA },
    decisions: { type: 'array', maxItems: 64, items: { type: 'object', additionalProperties: false,
      required: ['id', 'ref', 'status', 'reason', 'roles', 'marginalGain', 'tokenDelta', 'unitId', 'sourceIdentity', 'priority', 'distance'], properties: {
        id: digest, ref,
        unitId: { anyOf: [digest, { type: 'null' }] }, sourceIdentity: { anyOf: [sourceIdentity, { type: 'null' }] },
        priority: bounded(4), distance: { type: ['number', 'null'], minimum: 0 },
        status: { enum: ['selected', 'deferred', 'omitted'] }, reason: { type: 'string' },
        roles: { type: 'array', maxItems: 4, uniqueItems: true, items: role },
        marginalGain: { type: ['number', 'null'] }, tokenDelta: { type: ['integer', 'null'], minimum: -1048576, maximum: 1048576 }
      } } },
    coverage: { type: 'object', additionalProperties: false, required: ['meaning', 'available', 'selected', 'missing', 'unknownRoleIds'],
      properties: { meaning: { const: 'heuristic-graph-incidence' },
        available: { type: 'array', maxItems: 4, uniqueItems: true, items: role },
        selected: { type: 'array', maxItems: 4, uniqueItems: true, items: role }, missing: { type: 'array', maxItems: 4, uniqueItems: true, items: role },
        unknownRoleIds: { type: 'array', maxItems: 64, uniqueItems: true, items: digest } } },
    stats: { type: 'object', additionalProperties: false,
      required: ['observed', 'admitted', 'omittedBeyondPool', 'poolBytes', 'workUnits', 'pairwise', 'measurements'],
      properties: { observed: bounded(Number.MAX_SAFE_INTEGER), admitted: bounded(64), omittedBeyondPool: bounded(Number.MAX_SAFE_INTEGER),
        poolBytes: bounded(524288), workUnits: bounded(524288), pairwise: bounded(4096), measurements: bounded(128) } }
  }
};

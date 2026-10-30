export const TRIAGE_HISTORY_SELECTION_VERSION = 1;
export const TRIAGE_HISTORY_SELECTION_POLICY = 'exact-lineage-route-affinity-v1';
export const TRIAGE_HISTORY_LIMITS = Object.freeze({ records: 256, outputBytes: 1024 * 1024,
  cursorBytes: 32768, metadataReserveBytes: 32768 });
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const count = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const timestamp = { type: 'string', format: 'date-time', maxLength: 32 };
const id = { type: 'string', minLength: 1, maxLength: 4096 };
const nullableDigest = { anyOf: [digest, { type: 'null' }] };
const pair = { type: 'object', additionalProperties: false, required: ['exact', 'related'],
  properties: { exact: count, related: count } };
export const TRIAGE_HISTORY_CURSOR_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'policy', 'scopeHash', 'snapshotHash', 'asOf', 'after'],
  properties: { schemaVersion: { const: TRIAGE_HISTORY_SELECTION_VERSION },
    policy: { const: TRIAGE_HISTORY_SELECTION_POLICY }, scopeHash: digest, snapshotHash: digest,
    asOf: timestamp,
    after: { type: 'object', additionalProperties: false, required: ['timestamp', 'decisionId'],
      properties: { timestamp: { type: 'integer' }, decisionId: { type: 'string', minLength: 1, maxLength: 4096 } } }
  }
};

export const TRIAGE_HISTORY_SELECTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'policy', 'asOf', 'scopeHash', 'snapshotHash', 'mode', 'allocation', 'coverage',
    'items', 'continuation', 'continuationState', 'accounting', 'outputBytes'],
  properties: {
    schemaVersion: { const: TRIAGE_HISTORY_SELECTION_VERSION }, policy: { const: TRIAGE_HISTORY_SELECTION_POLICY },
    asOf: timestamp, scopeHash: digest, snapshotHash: nullableDigest, mode: { enum: ['initial', 'exact-continuation'] },
    allocation: { type: 'object', additionalProperties: false,
      required: ['requested', 'limit', 'exactReserved', 'outputBytesMax', 'retainedCandidatesMax', 'retainedCandidateBytesMax'],
      properties: { requested: count, limit: { ...count, maximum: TRIAGE_HISTORY_LIMITS.records },
        exactReserved: { ...count, maximum: TRIAGE_HISTORY_LIMITS.records },
        outputBytesMax: { const: TRIAGE_HISTORY_LIMITS.outputBytes },
        retainedCandidatesMax: { ...count, maximum: 3 * TRIAGE_HISTORY_LIMITS.records },
        retainedCandidateBytesMax: { const: 3 * TRIAGE_HISTORY_LIMITS.outputBytes } } },
    coverage: { type: 'object', additionalProperties: false,
      required: ['state', 'reads', 'readFailures', 'countsAreLowerBounds', 'candidates', 'omitted', 'oversized', 'earlierExactPassed'],
      properties: { state: { enum: ['complete', 'partial', 'disabled'] }, reads: count, readFailures: count,
        countsAreLowerBounds: { type: 'boolean' }, candidates: pair, omitted: pair, oversized: pair, earlierExactPassed: count } },
    items: { type: 'array', maxItems: TRIAGE_HISTORY_LIMITS.records,
      items: { type: 'object', additionalProperties: false,
        required: ['relation', 'sourceDecisionId', 'findingRecordId', 'matchedFields', 'score', 'routeMatch', 'scope', 'observation', 'validity'],
        properties: { relation: { enum: ['exactFinding', 'relatedPrecedent'] }, sourceDecisionId: id,
          findingRecordId: { anyOf: [id, { type: 'null' }] },
          matchedFields: { type: 'array', uniqueItems: true, maxItems: 6,
            items: { enum: ['findingRecordId', 'vulnerability', 'packageName', 'manifestBasename', 'service', 'env'] } },
          score: { type: 'integer', minimum: 1, maximum: 19 }, routeMatch: { type: 'boolean' },
          scope: { enum: ['selected-record-namespace', 'different-repository', 'different-finding-observation'] },
          observation: { type: 'object', additionalProperties: false, required: ['state', 'originalHash', 'currentHash', 'route'],
            properties: { state: { enum: ['unknown', 'identity-mismatch', 'same', 'changed'] },
              originalHash: nullableDigest, currentHash: nullableDigest, route: { enum: ['unknown', 'same', 'changed'] } } },
          validity: { type: 'object', additionalProperties: false,
            required: ['asOf', 'expiry', 'recorded', 'interpretation', 'supersession'],
            properties: { asOf: timestamp, expiry: { enum: ['absent', 'invalid', 'expired', 'not-expired'] },
              recorded: { enum: ['unknown', 'after-as-of', 'at-or-before-as-of'] },
              interpretation: { const: 'historical-only;not-approval-or-suppression' }, supersession: { const: 'unverified' } } }
        } } },
    continuation: { anyOf: [TRIAGE_HISTORY_CURSOR_SCHEMA, { type: 'null' }] },
    continuationState: { enum: ['disabled', 'unavailable-incomplete-observation', 'available', 'unavailable-record-byte-budget', 'exact-history-exhausted'] },
    accounting: { const: 'compact-json-history-plus-selection;not-process-heap' },
    outputBytes: { ...count, maximum: TRIAGE_HISTORY_LIMITS.outputBytes }
  }
};

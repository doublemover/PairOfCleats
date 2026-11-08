const count = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const nullableCount = { ...count, type: ['integer', 'null'] };
const state = { enum: ['complete', 'partial', 'unqualified', 'unsupported', 'unavailable', 'invalid', 'cancelled'] };
const reasonCounts = { type: 'object', additionalProperties: count };
export const IMPORT_EXTRACTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'producer', 'parser', 'source', 'scope', 'state', 'recognition', 'reasonCounts', 'limits', 'parserLimits',
    'counts', 'steps', 'entriesHash', 'reusePolicy', 'identity'],
  properties: {
    schemaVersion: { const: 1 }, producer: { type: 'object', additionalProperties: false, required: ['id', 'version'],
      properties: { id: { type: 'string', minLength: 1 }, version: { const: '1' } } },
    parser: { type: ['object', 'null'], additionalProperties: false, required: ['id', 'version', 'available'],
      properties: { id: { type: 'string', minLength: 1 }, version: { type: ['string', 'null'] }, available: { type: ['boolean', 'null'] } } },
    source: { type: 'object', additionalProperties: false, required: ['textHash', 'encoding', 'length', 'admittedLength', 'scannedLength'],
      properties: { textHash: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' }, encoding: { const: 'utf16le-js-string' },
        length: nullableCount, admittedLength: nullableCount, scannedLength: { const: null } } },
    scope: { type: 'string', minLength: 1 }, state, recognition: { enum: ['empty', 'nonempty', 'unknown'] },
    reasonCounts: { ...reasonCounts, maxProperties: 20 }, limits: { type: 'object', maxProperties: 8, additionalProperties: { type: ['number', 'null'], minimum: 0 } },
    parserLimits: { type: ['object', 'null'], maxProperties: 16, additionalProperties: { type: 'number', minimum: 0 } },
    counts: { type: 'object', additionalProperties: false, required: ['observed', 'retained', 'dropped'],
      properties: { observed: nullableCount, retained: count, dropped: { const: null } } },
    steps: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false,
      required: ['owner', 'input', 'retained', 'duplicates', 'invalid', 'omitted', 'limit'],
      properties: { owner: { type: 'string', minLength: 1, maxLength: 64 }, input: count, retained: count,
        duplicates: count, invalid: count, omitted: count, limit: { type: ['number', 'null'], minimum: 0 } } } },
    entriesHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, identity: { type: 'string', pattern: '^ie1:[a-f0-9]{64}$' },
    reusePolicy: { enum: ['qualified-scope', 'retain-qualified-static-subset', 'refresh-required'] }
  }
};

export const IMPORT_EXTRACTION_SUMMARY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'scope', 'inputState', 'state', 'files', 'states', 'relationStates', 'partialFiles', 'reasonCountUnit', 'omittedReasonObservations', 'recognizedEmpty', 'reasonCounts', 'samples', 'omittedSamples', 'sqlUsageFiles', 'sqlUsageStates'],
  properties: { schemaVersion: { const: 1 }, scope: { const: 'provided-file-relations' }, inputState: { enum: ['provided', 'unavailable'] }, state: { enum: ['complete', 'partial'] }, files: count,
    states: { type: 'object', additionalProperties: false, properties: Object.fromEntries(state.enum.map(name => [name, count])) },
    relationStates: { type: 'object', additionalProperties: false, properties: Object.fromEntries(state.enum.map(name => [name, count])) },
    partialFiles: count, reasonCountUnit: { const: 'files' }, omittedReasonObservations: count,
    recognizedEmpty: count, reasonCounts: { ...reasonCounts, maxProperties: 32 }, omittedSamples: count,
    sqlUsageFiles: count, sqlUsageStates: reasonCounts,
    samples: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false,
      required: ['file', 'state', 'relationState', 'sqlUsageState', 'identity', 'reasons'], properties: { file: { type: 'string', minLength: 1, maxLength: 1024 }, state, relationState: state, sqlUsageState: { anyOf: [state, { type: 'null' }] },
        identity: { type: ['string', 'null'] }, reasons: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 128 } } } } }
  }
};

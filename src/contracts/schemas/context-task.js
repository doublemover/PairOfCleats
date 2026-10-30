export const CONTEXT_TASK_POLICY_VERSION = 1;
export const CONTEXT_TASK_POLICY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'task', 'granularity'],
  properties: { schemaVersion: { const: CONTEXT_TASK_POLICY_VERSION }, task: { enum: ['edit-safe', 'exploration'] },
    granularity: { enum: ['file', 'function', 'excerpt'] }, wholeFileFallback: { type: 'boolean' } },
  oneOf: [
    { type: 'object', properties: { task: { const: 'edit-safe' }, granularity: { enum: ['file', 'function'] } } },
    { type: 'object', properties: { task: { const: 'exploration' }, granularity: { const: 'excerpt' }, wholeFileFallback: { const: false } } }
  ]
};
const completeFileUnit = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'granularity', 'requestedGranularity', 'fallbackUsed', 'boundaries', 'coordinateUnit', 'span', 'byteLength', 'sourceHash', 'indexSignature'],
  properties: { schemaVersion: { const: CONTEXT_TASK_POLICY_VERSION }, granularity: { const: 'file' },
    requestedGranularity: { enum: ['file', 'function'] }, fallbackUsed: { type: 'boolean' }, boundaries: { const: 'complete-file' },
    coordinateUnit: { const: 'utf16' }, span: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 0 } },
    byteLength: { type: 'integer', minimum: 0, maximum: 131072 }, sourceHash: { type: 'string', pattern: '^sha(1:[a-f0-9]{40}|256:[a-f0-9]{64})$' },
    indexSignature: { type: 'string', minLength: 1 } }
};
const completeFunctionUnit = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'granularity', 'requestedGranularity', 'fallbackUsed', 'boundaries', 'coordinateUnit',
    'span', 'byteLength', 'sourceHash', 'contentHash', 'sourceLength', 'indexSignature', 'parser'],
  properties: { schemaVersion: { const: 2 }, granularity: { const: 'function' }, requestedGranularity: { const: 'function' },
    fallbackUsed: { const: false }, boundaries: { const: 'complete-function' }, coordinateUnit: { const: 'utf16' },
    span: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 0, maximum: 1048576 } },
    byteLength: { type: 'integer', minimum: 1, maximum: 131072 },
    sourceHash: { type: 'string', pattern: '^sha(1:[a-f0-9]{40}|256:[a-f0-9]{64})$' },
    contentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    sourceLength: { type: 'integer', minimum: 1, maximum: 1048576 }, indexSignature: { type: 'string', minLength: 1 },
    parser: { type: 'object', additionalProperties: false, required: ['family', 'version'], properties: {
      family: { enum: ['babel', 'acorn', 'esprima'] }, version: { type: 'string', pattern: '^[0-9][A-Za-z0-9.+-]{0,127}$' }
    } }
  }
};
export const CONTEXT_EDIT_UNIT_SCHEMA = { oneOf: [completeFileUnit, completeFunctionUnit] };

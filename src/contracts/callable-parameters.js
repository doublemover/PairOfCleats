export const CALLABLE_PARAMETERS_VERSION = 1;
export const MAX_CALLABLE_PARAMETER_SLOTS = 256;
export const MAX_CALLABLE_ANNOTATION_TEXT = 4096;
const count = { type: 'integer', minimum: 0 };
const nullableCount = { type: ['integer', 'null'], minimum: 0 };
const nullableText = { type: ['string', 'null'], maxLength: MAX_CALLABLE_ANNOTATION_TEXT };
const sourceRange = { anyOf: [{ type: 'null' }, { type: 'object', required: ['start', 'end'],
  properties: { start: count, end: count }, additionalProperties: false }] };
const annotation = { type: 'object', required: ['presence', 'state', 'text', 'range'], additionalProperties: false,
  properties: { presence: { enum: ['present', 'absent', 'unavailable'] }, state: { enum: ['complete', 'partial'] },
    text: nullableText, range: sourceRange } };
const slot = { type: 'object', additionalProperties: false,
  required: ['ordinal', 'runtimeOrdinal', 'role', 'name', 'namePresence', 'binding', 'optional', 'defaulted', 'rest', 'range', 'bindingRange', 'type'],
  properties: { ordinal: count, runtimeOrdinal: nullableCount, role: { enum: ['receiver', 'runtime'] }, name: nullableText,
    namePresence: { enum: ['present', 'pattern', 'unavailable'] }, binding: { enum: ['identifier', 'object-pattern', 'array-pattern', 'unknown'] },
    optional: { type: 'boolean' }, defaulted: { type: 'boolean' }, rest: { type: 'boolean' },
    range: sourceRange, bindingRange: sourceRange, type: annotation } };
export const CALLABLE_PARAMETERS_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'language', 'parser', 'role', 'presence', 'state', 'declarationRange', 'signatureRange',
    'signaturePreviewTruncated', 'bodyRange', 'formalSlotCount', 'runtimeSlotCount', 'retainedSlots', 'omittedSlots', 'slotCoverage', 'slots', 'arity', 'returnAnnotation'],
  properties: { schemaVersion: { const: CALLABLE_PARAMETERS_VERSION }, language: { type: 'string', minLength: 1 },
    parser: { type: 'string', minLength: 1 }, role: { enum: ['function', 'arrow', 'constructor', 'getter', 'setter'] },
    presence: { enum: ['known', 'unavailable'] }, state: { enum: ['complete', 'partial'] }, declarationRange: sourceRange,
    signatureRange: sourceRange, signaturePreviewTruncated: { type: 'boolean' }, bodyRange: sourceRange,
    formalSlotCount: nullableCount, runtimeSlotCount: nullableCount, retainedSlots: count, omittedSlots: nullableCount,
    slotCoverage: { enum: ['complete', 'partial'] }, slots: { type: 'array', maxItems: MAX_CALLABLE_PARAMETER_SLOTS, items: slot },
    arity: { type: 'object', required: ['state', 'min', 'max', 'variadic'], additionalProperties: false,
      properties: { state: { enum: ['complete', 'unavailable'] }, min: nullableCount, max: nullableCount, variadic: { type: ['boolean', 'null'] } } },
    returnAnnotation: annotation } };

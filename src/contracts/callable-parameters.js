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

export const CALLABLE_PARAMETER_SUMMARY_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'projection', 'language', 'parser', 'source', 'state', 'reason', 'formalSlotCount', 'runtimeSlotCount', 'declarationRange', 'signatureRange', 'arity'],
  properties: { schemaVersion: { const: CALLABLE_PARAMETERS_VERSION }, projection: { const: 'arity-summary' },
    language: { type: ['string', 'null'], maxLength: 64 }, parser: { type: ['string', 'null'], maxLength: 64 },
    source: { enum: ['parser-node', 'legacy-signature-subset', 'unavailable'] }, state: { enum: ['complete', 'partial', 'unavailable'] },
    reason: { type: 'string', maxLength: 160 }, formalSlotCount: nullableCount, runtimeSlotCount: nullableCount,
    declarationRange: sourceRange, signatureRange: sourceRange, arity: CALLABLE_PARAMETERS_SCHEMA.properties.arity } };
const validCount = value => Number.isSafeInteger(value) && value >= 0;
const validRange = value => value && validCount(value.start) && validCount(value.end) && value.end >= value.start;
export const unavailableCallableParameters = (reason, language = null, parser = null) => ({
  schemaVersion: CALLABLE_PARAMETERS_VERSION, projection: 'arity-summary',
  language: typeof language === 'string' && language.length <= 64 ? language : null,
  parser: typeof parser === 'string' && parser.length <= 64 ? parser : null,
  source: 'unavailable', state: 'unavailable', reason: typeof reason === 'string' ? reason.slice(0, 160) : 'parameter-authority-unavailable',
  formalSlotCount: null, runtimeSlotCount: null,
  declarationRange: null, signatureRange: null, arity: { state: 'unavailable', min: null, max: null, variadic: null }
});
export const isQualifiedCallableSummary = summary => summary?.schemaVersion === CALLABLE_PARAMETERS_VERSION
  && summary.projection === 'arity-summary' && ['complete', 'partial'].includes(summary.state)
  && summary.arity?.state === 'complete' && validCount(summary.arity.min) && typeof summary.arity.variadic === 'boolean'
  && (summary.arity.variadic ? summary.arity.max === null : validCount(summary.arity.max) && summary.arity.min <= summary.arity.max)
  && (summary.source === 'legacy-signature-subset' && ['javascript', 'typescript'].includes(summary.language)
    || summary.source === 'parser-node' && summary.state === 'complete' && (summary.language === 'typescript' && ['typescript-compiler', 'typescript-babel'].includes(summary.parser)
      || summary.language === 'javascript' && ['javascript-acorn', 'javascript-babel', 'javascript-esprima'].includes(summary.parser))
      && validCount(summary.formalSlotCount) && validCount(summary.runtimeSlotCount)
      && summary.runtimeSlotCount <= summary.formalSlotCount && summary.formalSlotCount - summary.runtimeSlotCount <= 1
      && summary.arity.min <= summary.runtimeSlotCount && (summary.arity.variadic || summary.arity.max === summary.runtimeSlotCount)
      && (!summary.arity.variadic || summary.runtimeSlotCount > 0 && summary.arity.min < summary.runtimeSlotCount)
      && validRange(summary.declarationRange) && validRange(summary.signatureRange)
      && summary.signatureRange.start >= summary.declarationRange.start && summary.signatureRange.end <= summary.declarationRange.end);

/** Persist only the fixed-size arity projection in symbols, independent of
 * signature/type previews or bounded slot detail. Full source slots stay owned
 * by doc metadata; unavailable authority cannot become legacy text fallback.
 */
export const summarizeCallableParameters = contract => {
  const unavailable = unavailableCallableParameters('callable-parameters-unavailable',
    typeof contract?.language === 'string' ? contract.language : null, typeof contract?.parser === 'string' ? contract.parser : null);
  if (contract?.schemaVersion !== CALLABLE_PARAMETERS_VERSION || contract.presence !== 'known' || contract.state !== 'complete') return unavailable;
  const summary = { schemaVersion: CALLABLE_PARAMETERS_VERSION, projection: 'arity-summary', language: contract.language, parser: contract.parser,
    source: 'parser-node', state: 'complete', reason: 'source-parameter-nodes', formalSlotCount: contract.formalSlotCount,
    runtimeSlotCount: contract.runtimeSlotCount, declarationRange: contract.declarationRange ? { ...contract.declarationRange } : null,
    signatureRange: contract.signatureRange ? { ...contract.signatureRange } : null, arity: { ...contract.arity } };
  return isQualifiedCallableSummary(summary) ? summary : unavailable;
};
export const callableSummaryProjectionErrors = summary => {
  if (!summary) return [];
  if (summary.state === 'unavailable') return summary.arity?.state === 'unavailable'
    && summary.arity.min === null && summary.arity.max === null && summary.arity.variadic === null ? [] : ['Unavailable parameter authority contains qualified arity.'];
  return isQualifiedCallableSummary(summary) ? [] : ['Parameter authority summary has inconsistent qualification or counts.'];
};

/** Retain runtime ordinals: receivers and binding-pattern names cannot shift
 * later actuals. Rest binds one array; destructured names require another owner.
 */
export const runtimeParameterSlots = docmeta => {
  const contract = docmeta?.callableParameters;
  if (contract) return contract.schemaVersion === CALLABLE_PARAMETERS_VERSION && contract.state === 'complete' && Array.isArray(contract.slots)
    ? contract.slots.filter(slot => slot.role === 'runtime') : [];
  const names = Array.isArray(docmeta?.paramNames) ? docmeta.paramNames : Array.isArray(docmeta?.params) ? docmeta.params : [];
  return names.map((name, runtimeOrdinal) => ({ name, runtimeOrdinal, rest: false, binding: 'identifier' }));
};
export const runtimeParameterFor = (slots, ordinal) => slots.find(slot => slot.runtimeOrdinal === ordinal
  || slot.rest && slot.runtimeOrdinal <= ordinal) || null;

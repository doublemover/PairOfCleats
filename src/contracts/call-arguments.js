export const CALL_ARGUMENTS_VERSION = 1;
export const MAX_CALL_ARGUMENT_SLOTS = 32;
const count = { type: 'integer', minimum: 0 }, nullableCount = { type: ['integer', 'null'], minimum: 0 };
const range = { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
  required: ['start', 'end'], properties: { start: count, end: count } }] };
export const CALL_ARGUMENTS_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['version', 'source', 'language', 'syntacticArgumentCount', 'arity', 'slotCoverage', 'omittedSlots', 'slots'],
  properties: { version: { const: CALL_ARGUMENTS_VERSION }, source: { enum: ['parser-node', 'unavailable'] },
    language: { type: ['string', 'null'], maxLength: 64 }, syntacticArgumentCount: nullableCount,
    arity: { type: 'object', additionalProperties: false, required: ['state', 'min', 'max'],
      properties: { state: { enum: ['exact', 'bounded', 'unavailable'] }, min: nullableCount, max: nullableCount } },
    slotCoverage: { enum: ['complete', 'partial', 'unavailable'] }, omittedSlots: nullableCount,
    slots: { type: 'array', maxItems: MAX_CALL_ARGUMENT_SLOTS, items: { type: 'object', additionalProperties: false,
      required: ['operandOrdinal', 'expansionOrdinal', 'runtimeOrdinal', 'kind', 'range', 'preview', 'previewTruncated', 'literalType'],
      properties: { operandOrdinal: count, expansionOrdinal: nullableCount, runtimeOrdinal: nullableCount,
        kind: { enum: ['ordinary', 'spread', 'hole', 'unknown'] }, range,
        preview: { type: 'string', maxLength: 80 }, previewTruncated: { type: 'boolean' },
        literalType: { enum: ['string', 'number', 'boolean', 'null', 'bigint', 'undefined', 'regexp', 'unsupported', null] } } } } }
};
export const unavailableCallArguments = (language = null) => ({ version: CALL_ARGUMENTS_VERSION,
  source: 'unavailable', language: typeof language === 'string' ? language.slice(0, 64) : null,
  syntacticArgumentCount: null, arity: { state: 'unavailable', min: null, max: null },
  slotCoverage: 'unavailable', omittedSlots: null, slots: [] });
const countOk = value => Number.isSafeInteger(value) && value >= 0;
export const callArgumentProjectionErrors = value => {
  if (!value || value.version !== CALL_ARGUMENTS_VERSION) return ['argument evidence version is unavailable'];
  if (value.source === 'unavailable') return value.arity?.state === 'unavailable'
    && value.arity.min === null && value.arity.max === null && value.syntacticArgumentCount === null
    && value.slotCoverage === 'unavailable' && value.slots?.length === 0 ? [] : ['unavailable arguments contain qualified facts'];
  if (value.source !== 'parser-node' || !countOk(value.syntacticArgumentCount)
    || !countOk(value.omittedSlots) || !Array.isArray(value.slots) || value.slots.length > MAX_CALL_ARGUMENT_SLOTS
    || !countOk(value.arity?.min) || !(value.arity.max === null || countOk(value.arity.max) && value.arity.max >= value.arity.min)
    || !['exact', 'bounded'].includes(value.arity.state)
    || (value.arity.state === 'exact') !== (value.arity.max === value.arity.min)
    || !['complete', 'partial'].includes(value.slotCoverage)) return ['argument evidence has inconsistent counts or arity'];
  if (value.arity.state === 'exact' && value.slots.length + value.omittedSlots !== value.arity.min) return ['exact argument count differs from retained and omitted slots'];
  let prior = -1, unknownPosition = false;
  for (const slot of value.slots) {
    if (!countOk(slot.operandOrdinal) || slot.operandOrdinal >= value.syntacticArgumentCount
      || slot.runtimeOrdinal !== null && (!countOk(slot.runtimeOrdinal) || slot.runtimeOrdinal <= prior || unknownPosition
        || value.arity.max !== null && slot.runtimeOrdinal >= value.arity.max)
      || slot.range && (!countOk(slot.range.start) || !countOk(slot.range.end) || slot.range.end < slot.range.start)
      || typeof slot.preview !== 'string' || slot.preview.length > 80) return ['argument slot has invalid identity or position'];
    if (slot.runtimeOrdinal === null) unknownPosition = true;
    else prior = slot.runtimeOrdinal;
  }
  if (value.slotCoverage === 'complete' && (value.omittedSlots || value.arity.state !== 'exact'
    || value.slots.some(slot => slot.previewTruncated || ['spread', 'unknown'].includes(slot.kind)))) return ['complete argument coverage omits evidence'];
  return [];
};
export const resolveCallArguments = detail => {
  const value = detail?.arguments || detail?.extensions?.arguments;
  return value && !callArgumentProjectionErrors(value).length ? value : unavailableCallArguments(detail?.languageId || null);
};
export const exactCallArity = detail => {
  const value = resolveCallArguments(detail);
  return value.arity.state === 'exact' ? value.arity.min : null;
};
/** Legacy text remains usable for positive facts, never a negative completeness
 * claim or exact arity. An explicit unavailable receipt cannot fall back.
 */
export const callArgumentView = detail => {
  const explicit = detail?.arguments || detail?.extensions?.arguments;
  const value = resolveCallArguments(detail);
  if (explicit) return { ...value, complete: value.slotCoverage === 'complete' };
  let frontier = false;
  const slots = (Array.isArray(detail?.args) ? detail.args : []).slice(0, MAX_CALL_ARGUMENT_SLOTS).map((preview, index) => {
    preview = typeof preview === 'string' ? preview : '';
    if (preview.startsWith('...')) frontier = true;
    return { operandOrdinal: index, expansionOrdinal: null, runtimeOrdinal: frontier ? null : index,
      kind: frontier ? 'unknown' : 'ordinary', range: null, preview: preview.slice(0, 80),
      previewTruncated: !preview || preview.length >= 80 || preview.endsWith('...'), literalType: null };
  });
  return { ...value, slots, complete: false };
};

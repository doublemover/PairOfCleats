import { exactRangeToOffsets } from '../../lsp/positions.js';
import { canonicalizeTypeText } from '../../../../shared/type-normalization.js';
import { getOwn } from '../../../../shared/object-record.js';
import { createInlayOwnership } from './inlay-ownership.js';

const DEFAULT_SEMANTIC_CLASS_MAP = Object.freeze({
  namespace: 'namespace',
  type: 'type',
  class: 'class',
  enum: 'enum',
  interface: 'interface',
  struct: 'struct',
  typeParameter: 'type_parameter',
  parameter: 'parameter',
  variable: 'variable',
  property: 'property',
  enumMember: 'enum_member',
  event: 'event',
  function: 'function',
  method: 'method',
  macro: 'macro',
  keyword: 'keyword'
});

const PROVIDER_SEMANTIC_CLASS_OVERRIDES = Object.freeze({
  clangd: Object.freeze({
    type: 'type',
    method: 'method',
    function: 'function',
    parameter: 'parameter',
    variable: 'variable'
  }),
  pyright: Object.freeze({
    function: 'function',
    method: 'method',
    class: 'class',
    parameter: 'parameter',
    variable: 'variable'
  }),
  sourcekit: Object.freeze({
    method: 'method',
    function: 'function',
    property: 'property',
    parameter: 'parameter'
  }),
  'rust-analyzer': Object.freeze({
    struct: 'struct',
    enum: 'enum',
    function: 'function',
    method: 'method',
    variable: 'variable'
  })
});

const normalizeProviderId = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const normalizeTokenType = (value) => typeof value === 'string' ? value.trim() : '';
const isProtocolUnsignedInteger = (value) => Number.isInteger(value) && value >= 0 && value <= 2147483647;
const isStringLegend = (values) => {
  if (!Array.isArray(values)) return false;
  for (const value of values) if (typeof value !== 'string') return false;
  return true;
};

const flattenInlayLabel = (label) => {
  if (typeof label === 'string') return label.trim();
  if (Array.isArray(label)) {
    return label.map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry.value === 'string') return entry.value;
      return '';
    }).join('').trim();
  }
  return '';
};

const buildHintOffset = (hint, lineIndex, text, positionEncoding) => {
  if (!hint || typeof hint !== 'object') return null;
  if (!hint.position || typeof hint.position !== 'object') return null;
  return exactRangeToOffsets(lineIndex,{start:hint.position,end:hint.position},{text,positionEncoding})?.start ?? null;
};

/**
 * Map provider token types to stable internal semantic classes.
 *
 * @param {{providerId?:string|null,tokenType?:string|null}} input
 * @returns {string|null}
 */
export const normalizeSemanticTokenClass = ({ providerId = null, tokenType = null }) => {
  const normalizedTokenType = normalizeTokenType(tokenType);
  if (!normalizedTokenType) return null;
  const overrides = getOwn(PROVIDER_SEMANTIC_CLASS_OVERRIDES, normalizeProviderId(providerId));
  return (overrides ? getOwn(overrides, normalizedTokenType) : null)
    || getOwn(DEFAULT_SEMANTIC_CLASS_MAP, normalizedTokenType)
    || null;
};

/**
 * Decode one complete relative-token payload. Invalid rows invalidate its whole
 * delta chain; a skipped row cannot supply the anchor for the following token.
 * Multiline tokens are not negotiated by this client.
 *
 * @param {{
 *   data?:number[]|null,
 *   legend?:{tokenTypes?:string[],tokenModifiers?:string[]}|null,
 *   providerId?:string|null,
 *   lineIndex?:number[]|null,
 *   text?:string|null,
 *   positionEncoding?:string|null
 * }} input
 * @returns {Array<object>}
 */
export const decodeSemanticTokens = ({
  data = null, legend = null, providerId = null, lineIndex = null, text = null, positionEncoding = 'utf-16'
} = {}) => {
  if (!Array.isArray(data) || data.length % 5 !== 0) throw new TypeError('Invalid LSP semantic token tuple payload.');
  const tokenTypes = legend?.tokenTypes;
  const tokenModifiers = legend?.tokenModifiers;
  if (!isStringLegend(tokenTypes) || !isStringLegend(tokenModifiers)) {
    throw new TypeError('Invalid LSP semantic token legend.');
  }
  const sourceProvided = lineIndex !== null || text !== null;
  if (sourceProvided && (!Array.isArray(lineIndex) || typeof text !== 'string')) {
    throw new TypeError('Incomplete LSP semantic token source.');
  }
  const modifierCount = Math.min(31, tokenModifiers.length);
  const modifierMask = 2 ** modifierCount - 1;
  const decoded = [];
  let line = 0;
  let start = 0;
  for (let index = 0; index < data.length; index += 5) {
    const deltaLine = data[index];
    const deltaStart = data[index + 1];
    const length = data[index + 2];
    const tokenTypeIdx = data[index + 3];
    const modifierBits = data[index + 4];
    if (![deltaLine, deltaStart, length, tokenTypeIdx, modifierBits].every(isProtocolUnsignedInteger)
      || tokenTypeIdx >= tokenTypes.length || modifierBits > modifierMask) {
      throw new TypeError(`Invalid LSP semantic token tuple at ${index / 5}.`);
    }
    if (deltaLine > 0) {
      line += deltaLine;
      start = deltaStart;
    } else {
      start += deltaStart;
    }
    const end = start + length;
    if (!isProtocolUnsignedInteger(line) || !isProtocolUnsignedInteger(start) || !isProtocolUnsignedInteger(end)) {
      throw new TypeError(`Invalid LSP semantic token position at ${index / 5}.`);
    }
    if (sourceProvided && !exactRangeToOffsets(lineIndex, {
      start: { line, character: start }, end: { line, character: end }
    }, { text, positionEncoding })) {
      throw new TypeError(`LSP semantic token is outside an exact source span at ${index / 5}.`);
    }
    const tokenType = tokenTypes[tokenTypeIdx];
    const modifiers = [];
    for (let bit = 0; bit < modifierCount; bit += 1) {
      if ((modifierBits & (1 << bit)) !== 0) modifiers.push(tokenModifiers[bit]);
    }
    decoded.push({
      line,
      startCharacter: start,
      endCharacter: end,
      length,
      tokenType,
      tokenModifiers: modifiers,
      semanticClass: normalizeSemanticTokenClass({ providerId, tokenType })
    });
  }
  return decoded;
};

/**
 * Find the most specific semantic token that covers a position.
 *
 * @param {Array<object>} tokens
 * @param {{line:number,character:number}|null} position
 * @returns {object|null}
 */
export const findSemanticTokenAtPosition = (tokens, position) => {
  if (!Array.isArray(tokens) || !position) return null;
  const { line, character } = position;
  if (!isProtocolUnsignedInteger(line) || !isProtocolUnsignedInteger(character)) return null;
  let match = null;
  for (const token of tokens) {
    if (!token || token.line !== line || !isProtocolUnsignedInteger(token.startCharacter)
      || !isProtocolUnsignedInteger(token.endCharacter) || token.endCharacter <= token.startCharacter
      || token.length !== token.endCharacter - token.startCharacter) continue;
    if (character < token.startCharacter || character >= token.endCharacter) continue;
    if (!match || token.length < match.length) {
      match = token;
    }
  }
  return match;
};

/**
 * Parse low-confidence type evidence from inlay-hint labels that fall within a
 * target source range.
 *
 * @param {{
 *   hints?:Array<object>|null,
 *   lineIndex:number[],
 *   text:string,
 *   targetRange:{start:number,end:number}|null,
 *   positionEncoding?:string|null,
 *   paramNames?:string[]|null,
 *   languageId?:string|null
 * }} input
 * @returns {{returnType?:string,paramTypes?:object,hintCount:number}|null}
 */
export const parseInlayHintSignalInfo = ({
  hints = null,
  lineIndex,
  text,
  targetRange,
  positionEncoding = 'utf-16',
  paramNames = null,
  languageId = null,
  declarationNameRange = null
} = {}) => {
  if (!Array.isArray(hints) || !Array.isArray(lineIndex) || !targetRange) return null;
  const startOffset = Number(targetRange.start);
  const endOffset = Number(targetRange.end);
  if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset) || endOffset < startOffset) return null;
  const normalizedParamNames = Array.isArray(paramNames)
    ? paramNames.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const ownership=createInlayOwnership({text,targetRange,paramNames:normalizedParamNames,nameRange:declarationNameRange});
  const observations=[];
  const collectedParamTypes = Object.create(null);
  let returnType = null;
  let hintCount = 0;

  const sortedHints = hints
    .map((hint) => ({
      hint,
      offset: buildHintOffset(hint, lineIndex, text, positionEncoding)
    }))
    .filter((entry) => Number.isFinite(entry.offset) && entry.offset >= startOffset && entry.offset < endOffset)
    .sort((left, right) => Number(left.offset) - Number(right.offset));

  for (const { hint,offset } of sortedHints) {
    const label = flattenInlayLabel(hint?.label);
    if (!label) continue;
    const role=hint?.kind == null || hint.kind === 1 ? ownership(offset) : null;
    if(!role) {observations.push({label,offset,reason:'unqualified-inlay-role'});continue;}
    const returnMatch = role.role === 'return' && label.match(/^(?:->|:)\s*(.+)$/u);
    if (returnMatch) {
      const normalized = canonicalizeTypeText(returnMatch[1], { languageId });
      if (normalized.displayText && !returnType) {
        returnType = normalized.displayText;
        hintCount += 1;
      }
      continue;
    }
    const namedParamMatch = label.match(/^([A-Za-z_][\w$]*)\s*:\s*(.+)$/u);
    if (namedParamMatch && role.role === 'parameter' && namedParamMatch[1] === role.name) {
      const paramName = namedParamMatch[1];
      const normalized = canonicalizeTypeText(namedParamMatch[2], { languageId });
      if (normalized.displayText) {
        collectedParamTypes[paramName] = [{
          type: normalized.displayText,
          normalizedType: normalized.canonicalText,
          originalText: normalized.originalText,
          confidence: 0.55,
          source: 'lsp_inlay'
        }];
        hintCount += 1;
      }
      continue;
    }
    const anonymousParamMatch = label.match(/^:\s*(.+)$/u);
    if (anonymousParamMatch && role.role === 'parameter') {
      const paramName = role.name;
      const normalized = canonicalizeTypeText(anonymousParamMatch[1], { languageId });
      if (normalized.displayText) {
        collectedParamTypes[paramName] = [{
          type: normalized.displayText,
          normalizedType: normalized.canonicalText,
          originalText: normalized.originalText,
          confidence: 0.55,
          source: 'lsp_inlay'
        }];
        hintCount += 1;
      }
    }
  }

  if (!returnType && !Object.keys(collectedParamTypes).length && !observations.length) return null;
  return {
    ...(returnType ? { returnType,returnTypeSource:'lsp_inlay' } : {}),
    ...(Object.keys(collectedParamTypes).length ? { paramTypes: collectedParamTypes } : {}),
    hintCount,
    observations,
    evidenceStrength:'hint-only'
  };
};

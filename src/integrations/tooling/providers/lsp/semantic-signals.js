import { positionToOffset } from '../../lsp/positions.js';
import { canonicalizeTypeText } from '../../../../shared/type-normalization.js';

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

const normalizeProviderId = (value) => String(value || '').trim().toLowerCase();
const normalizeTokenType = (value) => String(value || '').trim();

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
  return positionToOffset(lineIndex, hint.position, { text, positionEncoding });
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
  const overrides = PROVIDER_SEMANTIC_CLASS_OVERRIDES[normalizeProviderId(providerId)] || null;
  return overrides?.[normalizedTokenType]
    || DEFAULT_SEMANTIC_CLASS_MAP[normalizedTokenType]
    || null;
};

/**
 * Decode delta-encoded LSP semantic token payloads into absolute token records.
 *
 * @param {{
 *   data?:number[]|null,
 *   legend?:{tokenTypes?:string[],tokenModifiers?:string[]}|null,
 *   providerId?:string|null
 * }} input
 * @returns {Array<object>}
 */
export const decodeSemanticTokens = ({ data = null, legend = null, providerId = null } = {}) => {
  const rows = Array.isArray(data) ? data : [];
  const tokenTypes = Array.isArray(legend?.tokenTypes) ? legend.tokenTypes : [];
  const tokenModifiers = Array.isArray(legend?.tokenModifiers) ? legend.tokenModifiers : [];
  const decoded = [];
  let line = 0;
  let start = 0;
  for (let index = 0; index + 4 < rows.length; index += 5) {
    const deltaLine = Number(rows[index]);
    const deltaStart = Number(rows[index + 1]);
    const length = Number(rows[index + 2]);
    const tokenTypeIdx = Number(rows[index + 3]);
    const modifierBits = Number(rows[index + 4]);
    if (!Number.isFinite(deltaLine) || !Number.isFinite(deltaStart) || !Number.isFinite(length)) continue;
    if (deltaLine > 0) {
      line += Math.max(0, Math.floor(deltaLine));
      start = Math.max(0, Math.floor(deltaStart));
    } else {
      start += Math.max(0, Math.floor(deltaStart));
    }
    const normalizedLength = Math.max(0, Math.floor(length));
    const tokenType = tokenTypes[Math.max(0, Math.floor(tokenTypeIdx))] || null;
    const modifiers = [];
    for (let bit = 0; bit < tokenModifiers.length; bit += 1) {
      if ((modifierBits & (1 << bit)) !== 0) modifiers.push(tokenModifiers[bit]);
    }
    decoded.push({
      line,
      startCharacter: start,
      endCharacter: start + normalizedLength,
      length: normalizedLength,
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
  const line = Number(position.line);
  const character = Number(position.character);
  if (!Number.isFinite(line) || !Number.isFinite(character)) return null;
  let match = null;
  for (const token of tokens) {
    if (!token || Number(token.line) !== line) continue;
    if (character < Number(token.startCharacter) || character > Number(token.endCharacter)) continue;
    if (!match || Number(token.length) < Number(match.length)) {
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
  languageId = null
} = {}) => {
  if (!Array.isArray(hints) || !Array.isArray(lineIndex) || !targetRange) return null;
  const startOffset = Number(targetRange.start);
  const endOffset = Number(targetRange.end);
  if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset) || endOffset < startOffset) return null;
  const normalizedParamNames = Array.isArray(paramNames)
    ? paramNames.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const unresolvedParamNames = normalizedParamNames.slice();
  const collectedParamTypes = Object.create(null);
  let returnType = null;
  let hintCount = 0;

  const sortedHints = hints
    .map((hint) => ({
      hint,
      offset: buildHintOffset(hint, lineIndex, text, positionEncoding)
    }))
    .filter((entry) => Number.isFinite(entry.offset) && entry.offset >= startOffset && entry.offset <= endOffset)
    .sort((left, right) => Number(left.offset) - Number(right.offset));

  for (const { hint } of sortedHints) {
    const label = flattenInlayLabel(hint?.label);
    if (!label) continue;
    const returnMatch = label.match(/^(?:->|:)\s*(.+)$/u);
    if (returnMatch) {
      const normalized = canonicalizeTypeText(returnMatch[1], { languageId });
      if (normalized.displayText && !returnType) {
        returnType = normalized.displayText;
        hintCount += 1;
      }
      continue;
    }
    const namedParamMatch = label.match(/^([A-Za-z_][\w$]*)\s*:\s*(.+)$/u);
    if (namedParamMatch) {
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
    if (anonymousParamMatch && unresolvedParamNames.length) {
      const paramName = unresolvedParamNames.shift();
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

  if (!returnType && !Object.keys(collectedParamTypes).length) return null;
  return {
    ...(returnType ? { returnType } : {}),
    ...(Object.keys(collectedParamTypes).length ? { paramTypes: collectedParamTypes } : {}),
    hintCount
  };
};

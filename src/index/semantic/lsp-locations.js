import { rangeToOffsets, getLspLineIndex, offsetToLspPosition as offsetToProtocolPosition } from '../../integrations/tooling/lsp/positions.js';
const point = value => value && Number.isSafeInteger(value.line) && value.line >= 0 && Number.isSafeInteger(value.character) && value.character >= 0;
export const offsetToLspPosition = (source, text, offset, encoding = 'utf-16') => {
  return offsetToProtocolPosition(getLspLineIndex(text,source),text,offset,encoding);
};
/** Reject clamped/invalid positions; exact mappings cannot repair malformed provider ranges. */
export const exactLspRange = (source, text, range, encoding = 'utf-16') => {
  const lines=getLspLineIndex(text,source);
  if (!range || !point(range.start) || !point(range.end) || range.start.line >= lines.length || range.end.line >= lines.length) return null;
  const offsets = rangeToOffsets(lines, range, { text, positionEncoding: encoding });
  if (offsets.end < offsets.start) return null;
  for (const offset of [offsets.start, offsets.end]) {
    if (offset > 0 && offset < text.length && text.charCodeAt(offset - 1) >= 0xd800
      && text.charCodeAt(offset - 1) <= 0xdbff && text.charCodeAt(offset) >= 0xdc00
      && text.charCodeAt(offset) <= 0xdfff) return null;
  }
  for (const key of ['start', 'end']) { const back = offsetToLspPosition(source, text, offsets[key], encoding); if (back.line !== range[key].line || back.character !== range[key].character) return null; }
  return [offsets.start, offsets.end];
};
export const normalizeLspLocations = payload => (Array.isArray(payload) ? payload : payload ? [payload] : []).map(raw => ({ raw,
  uri: raw?.uri || raw?.targetUri || null, range: raw?.range || raw?.targetSelectionRange || raw?.targetRange || null,
  targetRange: raw?.targetRange || raw?.range || null, originRange: raw?.originSelectionRange || null }));

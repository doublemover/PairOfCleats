import { rangeToOffsets } from '../../integrations/tooling/lsp/positions.js';
const point = value => value && Number.isSafeInteger(value.line) && value.line >= 0 && Number.isSafeInteger(value.character) && value.character >= 0;
export const offsetToLspPosition = (source, text, offset, encoding = 'utf-16') => {
  let low = 0, high = source.lineStarts.length;
  while (low + 1 < high) { const mid = (low + high) >>> 1; if (source.lineStarts[mid] <= offset) low = mid; else high = mid; }
  const prefix = text.slice(source.lineStarts[low], offset);
  return { line: low, character: encoding === 'utf-8' ? Buffer.byteLength(prefix) : encoding === 'utf-32' ? [...prefix].length : prefix.length };
};
/** Reject clamped/invalid positions; exact mappings cannot repair malformed provider ranges. */
export const exactLspRange = (source, text, range, encoding = 'utf-16') => {
  if (!range || !point(range.start) || !point(range.end) || range.start.line >= source.lineStarts.length || range.end.line >= source.lineStarts.length) return null;
  const offsets = rangeToOffsets(source.lineStarts, range, { text, positionEncoding: encoding });
  if (offsets.end < offsets.start) return null;
  for (const key of ['start', 'end']) { const back = offsetToLspPosition(source, text, offsets[key], encoding); if (back.line !== range[key].line || back.character !== range[key].character) return null; }
  return [offsets.start, offsets.end];
};
export const normalizeLspLocations = payload => (Array.isArray(payload) ? payload : payload ? [payload] : []).map(raw => ({ raw,
  uri: raw?.uri || raw?.targetUri || null, range: raw?.range || raw?.targetSelectionRange || raw?.targetRange || null,
  targetRange: raw?.targetRange || raw?.range || null, originRange: raw?.originSelectionRange || null }));

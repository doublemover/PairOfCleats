import { exactRangeToOffsets, getLspLineIndex, offsetToLspPosition as offsetToProtocolPosition } from '../../integrations/tooling/lsp/positions.js';
const point = value => value && Number.isSafeInteger(value.line) && value.line >= 0 && Number.isSafeInteger(value.character) && value.character >= 0;
export const offsetToLspPosition = (source, text, offset, encoding = 'utf-16') => {
  return offsetToProtocolPosition(getLspLineIndex(text,source),text,offset,encoding);
};
/** Reject clamped/invalid positions; exact mappings cannot repair malformed provider ranges. */
export const exactLspRange = (source, text, range, encoding = 'utf-16') => {
  const lines=getLspLineIndex(text,source);
  const offsets=exactRangeToOffsets(lines,range,{text,positionEncoding:encoding});
  return offsets ? [offsets.start,offsets.end] : null;
};
const comparePoints = (left, right) => left.line - right.line || left.character - right.character;
const protocolRange = value => value && point(value.start) && point(value.end)
  && comparePoints(value.start, value.end) <= 0;
export const lspRangeContains = (container, selection) => Boolean(protocolRange(container) && protocolRange(selection)
  && comparePoints(container.start, selection.start) <= 0 && comparePoints(container.end, selection.end) >= 0);

/** Preserve each protocol shape's required coordinates. A LocationLink cannot
 * borrow targetRange as a missing targetSelectionRange or prefer a mixed uri. */
export const normalizeLspLocations = payload => (Array.isArray(payload) ? payload : payload == null ? [] : [payload]).map(raw => {
  const link = raw && typeof raw === 'object' && Object.hasOwn(raw, 'targetUri');
  const uri = link ? raw.targetUri : raw?.uri;
  const range = link ? raw.targetSelectionRange : raw?.range;
  const targetRange = link ? raw.targetRange : raw?.range;
  const originRange = link ? raw.originSelectionRange ?? null : null;
  const valid = typeof uri === 'string' && uri.length > 0 && lspRangeContains(targetRange, range)
    && (originRange === null || protocolRange(originRange));
  return { raw, uri: typeof uri === 'string' ? uri : null, range: range || null,
    targetRange: targetRange || null, originRange, protocolShape: link ? 'LocationLink' : 'Location', valid };
});

/** Exact source selection plus its mandatory containing range. This is shared
 * by canonical binding joins and retained structured observations. */
export const exactLspLocationRange = (source, text, location, encoding = 'utf-16') => {
  if (location?.valid !== true) return null;
  const span = exactLspRange(source, text, location.range, encoding);
  const container = exactLspRange(source, text, location.targetRange, encoding);
  return span && container && span[0] >= container[0] && span[1] <= container[1] ? span : null;
};

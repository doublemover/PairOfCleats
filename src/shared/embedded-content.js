import { createHash } from 'node:crypto';

export const EMBEDDED_CONTENT_VERSION = 1;
export const EMBEDDED_CONTENT_LIMITS = Object.freeze({ pieces: 256, transformedBytes: 256 * 1024 });
const fail = reason => Object.assign(new TypeError(`Invalid embedded content (${reason}).`), {
  code: 'ERR_EMBEDDED_CONTENT', reason
});
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const policies = new Set(['markdown-fenced-content-v1', 'comment-content-margin-v1', 'comment-config-fenced-content-v1']);
export const isUtf16Boundary = (text, offset) => Number.isSafeInteger(offset) && offset >= 0 && offset <= text.length
  && !(offset > 0 && offset < text.length && text.charCodeAt(offset - 1) >= 0xd800
    && text.charCodeAt(offset - 1) <= 0xdbff && text.charCodeAt(offset) >= 0xdc00
    && text.charCodeAt(offset) <= 0xdfff);

/** Only original, ordered, unchanged UTF-16 pieces are exact. No generated
 * whitespace, line-ending normalization or guessed interval fills are allowed.
 * Adjacent pieces merge, preserving the cheap linear path for ordinary fences.
 */
export const createEmbeddedContentView = (text, ranges, { containerStart, containerEnd, policy } = {}) => {
  if (typeof text !== 'string' || !policies.has(policy)
    || !isUtf16Boundary(text, containerStart) || !isUtf16Boundary(text, containerEnd)
    || containerEnd < containerStart || !Array.isArray(ranges)) throw fail('container-or-policy');
  const pieces = [];
  let length = 0;
  for (const range of ranges) {
    const start = range?.start, end = range?.end;
    if (!isUtf16Boundary(text, start) || !isUtf16Boundary(text, end) || start < containerStart
      || end > containerEnd || end < start || start < (pieces.at(-1)?.end ?? containerStart)) throw fail('source-piece');
    if (start === end) continue;
    const last = pieces.at(-1);
    if (last?.end === start) { last.end = end; last.localEnd += end - start; }
    else {
      if (pieces.length >= EMBEDDED_CONTENT_LIMITS.pieces) throw fail('piece-budget');
      pieces.push({ start, end, localStart: length, localEnd: length + end - start });
    }
    length += end - start;
    if (pieces.length > 1 && length > EMBEDDED_CONTENT_LIMITS.transformedBytes) throw fail('content-byte-budget');
  }
  if (!pieces.length) throw fail('empty-content');
  const content = pieces.map(piece => text.slice(piece.start, piece.end)).join('');
  if (pieces.length > 1 && Buffer.byteLength(content) > EMBEDDED_CONTENT_LIMITS.transformedBytes) throw fail('content-byte-budget');
  for (const piece of pieces) Object.freeze(piece);
  return Object.freeze({ schemaVersion: EMBEDDED_CONTENT_VERSION, kind: 'source-pieces', policy,
    containerStart, containerEnd, sourceStart: pieces[0].start, sourceEnd: pieces.at(-1).end,
    length, contentHash: hash(content), pieces: Object.freeze(pieces) });
};

/** Validate saved/plain products again; an intact descriptor is not proof that
 * the selected source still contains the bytes originally extracted from it.
 */
export const readEmbeddedContent = (text, view) => {
  if (!view || view.schemaVersion !== EMBEDDED_CONTENT_VERSION || view.kind !== 'source-pieces'
    || !Array.isArray(view.pieces) || view.pieces.length > EMBEDDED_CONTENT_LIMITS.pieces) throw fail('view-version-or-pieces');
  const admitted = createEmbeddedContentView(text, view.pieces, view);
  if (admitted.sourceStart !== view.sourceStart || admitted.sourceEnd !== view.sourceEnd
    || admitted.length !== view.length || admitted.contentHash !== view.contentHash
    || admitted.pieces.length !== view.pieces.length || admitted.pieces.some((piece, index) => {
    const other = view.pieces[index];
    return piece.start !== other.start || piece.end !== other.end
        || piece.localStart !== other.localStart || piece.localEnd !== other.localEnd;
  })) throw fail('source-or-map-changed');
  return admitted.pieces.map(piece => text.slice(piece.start, piece.end)).join('');
};

export const readSegmentContent = (text, segment) => segment?.contentView
  ? readEmbeddedContent(text, segment.contentView) : text.slice(segment.start, segment.end);

export const embeddedContentIdentity = view => hash(JSON.stringify({ version: view.schemaVersion,
  policy: view.policy, contentHash: view.contentHash, length: view.length,
  pieces: view.pieces.map(piece => [piece.start - view.sourceStart, piece.end - view.sourceStart,
    piece.localStart, piece.localEnd]) }));

/** Cross-field admission for schema-checked retained metadata without source
 * bytes. Exact byte qualification still belongs to readEmbeddedContent.
 */
export const assertEmbeddedContentView = view => {
  if (!view || view.schemaVersion !== EMBEDDED_CONTENT_VERSION || view.kind !== 'source-pieces'
    || !policies.has(view.policy) || !/^[a-f0-9]{64}$/u.test(view.contentHash)
    || !Array.isArray(view.pieces) || !view.pieces.length || view.pieces.length > EMBEDDED_CONTENT_LIMITS.pieces
    || !['containerStart', 'containerEnd', 'sourceStart', 'sourceEnd', 'length'].every(key => Number.isSafeInteger(view[key]) && view[key] >= 0)
    || view.containerStart > view.sourceStart || view.sourceEnd > view.containerEnd
    || view.pieces.length > 1 && view.length > EMBEDDED_CONTENT_LIMITS.transformedBytes) throw fail('view-framing');
  let cursor = 0, last = view.containerStart;
  for (const piece of view.pieces) {
    if (!['start', 'end', 'localStart', 'localEnd'].every(key => Number.isSafeInteger(piece?.[key]) && piece[key] >= 0)
      || piece.start < last || piece.end <= piece.start || piece.localStart !== cursor
      || piece.localEnd !== cursor + piece.end - piece.start) throw fail('piece-framing');
    cursor = piece.localEnd; last = piece.end;
  }
  if (cursor !== view.length || view.pieces[0].start !== view.sourceStart || last !== view.sourceEnd) throw fail('view-extents');
  return view;
};

/** A local interval may cross removed host prefixes. Preserve every exact
 * source piece; its envelope is useful for display, never a constant-offset map.
 */
export const mapEmbeddedContentRange = (view, start, end) => {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > view.length) throw fail('local-range');
  const pieces = [];
  for (const piece of view.pieces) {
    if (start === end && start >= piece.localStart && start <= piece.localEnd) {
      const offset = piece.start + start - piece.localStart;
      // At an interior seam, point at the next authored character.
      if (start === piece.localEnd && start !== view.length) continue;
      return [{ start: offset, end: offset }];
    }
    const first = Math.max(start, piece.localStart), last = Math.min(end, piece.localEnd);
    if (last > first) pieces.push({ start: piece.start + first - piece.localStart,
      end: piece.start + last - piece.localStart });
  }
  if (!pieces.length) throw fail('unmapped-local-range');
  return pieces;
};

export const unmapEmbeddedContentRange = (view, start, end) => {
  let localStart = null, localEnd = null;
  for (const piece of view.pieces) {
    if (start >= piece.start && start < piece.end || start === piece.end && start === end) localStart ??= piece.localStart + start - piece.start;
    if (end > piece.start && end <= piece.end || end === piece.start && end === start) localEnd = piece.localStart + end - piece.start;
  }
  if (localStart === null || localEnd === null || localEnd < localStart) throw fail('unmapped-source-range');
  return { start: localStart, end: localEnd };
};

export const projectEmbeddedContentEnvelope = (view, range) => {
  if (!range) return null;
  const pieces = mapEmbeddedContentRange(view, range.start, range.end);
  return { start: pieces[0].start, end: pieces.at(-1).end };
};

export const readChunkContent = (text, chunk) => {
  if (!chunk?.segment?.contentView) return text.slice(chunk.start, chunk.end);
  const view = chunk.segment.contentView;
  const content = readEmbeddedContent(text, view);
  const local = unmapEmbeddedContentRange(view, chunk.start, chunk.end);
  return content.slice(local.start, local.end);
};

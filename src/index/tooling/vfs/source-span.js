import { toPosix } from '../../../shared/file-paths.js';
import { readEmbeddedContent, mapEmbeddedContentRange, unmapEmbeddedContentRange, isUtf16Boundary } from '../../../shared/embedded-content.js';

/** UTF-16 half-open coordinates shared by VFS documents and manifest production. */
const dividesSurrogate = (text, offset) => offset > 0 && offset < text.length
  && text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
  && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff;

const invalid = (reason, chunk, containerPath) => Object.assign(
  new RangeError(`Invalid VFS source span (${reason}) for ${containerPath || '<missing>'}`),
  { code: 'ERR_VFS_SOURCE_SPAN', reason, containerPath: containerPath || null,
    chunkUid: chunk?.chunkUid || null }
);

const assertSpan = (text, start, end, lower, upper, kind, chunk, containerPath) => {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    throw invalid(`${kind}-noninteger`, chunk, containerPath);
  }
  if (start < lower || end < start || end > upper) throw invalid(`${kind}-bounds`, chunk, containerPath);
  if (dividesSurrogate(text, start) || dividesSurrogate(text, end)) {
    throw invalid(`${kind}-surrogate-boundary`, chunk, containerPath);
  }
};

/**
 * Admit the original occurrence before any coalescing or text-derived identity.
 * Zero-width spans, including EOF, are valid at complete UTF-16 boundaries.
 * Untagged chunks use container coordinates. Legacy relative producers must
 * explicitly declare coordinateFrame:'segment'; numeric fit cannot prove origin.
 */
export const admitVfsSourceSpan = (chunk, text, containerPath, { requireTarget = true } = {}) => {
  if (!containerPath) throw invalid('missing-container', chunk, containerPath);
  if (typeof text !== 'string') throw invalid('missing-source', chunk, containerPath);
  if (chunk?.file && toPosix(chunk.file) !== containerPath) throw invalid('container-mismatch', chunk, containerPath);
  const segment = chunk?.segment;
  const segmentStart = segment ? segment.start : 0;
  const segmentEnd = segment ? segment.end : text.length;
  assertSpan(text, segmentStart, segmentEnd, 0, text.length, 'segment', chunk, containerPath);
  let logicalText = null;
  if (segment?.contentView) {
    try {
      logicalText = readEmbeddedContent(text, segment.contentView);
      if (segment.contentView.sourceStart !== segmentStart || segment.contentView.sourceEnd !== segmentEnd) throw new Error('extent');
    } catch (cause) { throw Object.assign(invalid('content-view', chunk, containerPath), { cause }); }
  }
  const frame = chunk?.coordinateFrame ?? 'container';
  if (frame !== 'container' && frame !== 'segment') throw invalid('unknown-frame', chunk, containerPath);
  if (frame === 'segment' && !segment) throw invalid('relative-without-segment', chunk, containerPath);
  // Manifest callers also supply document-only descriptors. They establish no
  // target range; either provided endpoint still requires full target admission.
  if (!requireTarget && chunk?.start === undefined && chunk?.end === undefined) {
    return { start: segmentStart, end: segmentEnd, segmentStart, segmentEnd,
      coordinateUnit: 'utf16', quality: 'exact', frame: 'document' };
  }
  if (!Number.isSafeInteger(chunk?.start) || !Number.isSafeInteger(chunk?.end)) {
    throw invalid('chunk-noninteger', chunk, containerPath);
  }
  let start = frame === 'segment' ? segmentStart + chunk.start : chunk.start;
  let end = frame === 'segment' ? segmentStart + chunk.end : chunk.end;
  let localRange = null;
  if (logicalText !== null) {
    try {
      localRange = frame === 'segment' ? { start: chunk.start, end: chunk.end }
        : unmapEmbeddedContentRange(segment.contentView, start, end);
      if (!isUtf16Boundary(logicalText, localRange.start) || !isUtf16Boundary(logicalText, localRange.end)) throw new Error('local-boundary');
      const pieces = mapEmbeddedContentRange(segment.contentView, localRange.start, localRange.end);
      if (frame === 'container' && (pieces[0].start !== start || pieces.at(-1).end !== end)) throw new Error('range');
      start = pieces[0].start; end = pieces.at(-1).end;
    } catch (cause) { throw Object.assign(invalid('content-range', chunk, containerPath), { cause }); }
  }
  assertSpan(text, start, end, segmentStart, segmentEnd, 'chunk', chunk, containerPath);
  return { start, end, segmentStart, segmentEnd, coordinateUnit: 'utf16', quality: 'exact', frame,
    ...(localRange ? { localRange } : {}) };
};

/** Bounded internal receipt; permissive omissions must remain visible to callers. */
export const createVfsSourceAdmission = ({ strict, inputChunks, log }) => {
  const receipt = { coordinateUnit: 'utf16', inputChunks, acceptedChunks: 0,
    rejectedChunks: 0, complete: true, reasons: {}, samples: [] };
  return {
    receipt,
    accept() { receipt.acceptedChunks++; },
    reject(error) {
      if (strict || error?.code !== 'ERR_VFS_SOURCE_SPAN') throw error;
      receipt.complete = false;
      receipt.rejectedChunks++;
      receipt.reasons[error.reason] = (receipt.reasons[error.reason] || 0) + 1;
      if (receipt.samples.length < 16) receipt.samples.push({ reason: error.reason,
        containerPath: error.containerPath, chunkUid: error.chunkUid });
    },
    report() {
      if (!receipt.complete && log) log(`[tooling] warning: VFS source admission ${JSON.stringify(receipt)}`);
    }
  };
};

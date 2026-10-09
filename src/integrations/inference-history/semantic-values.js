import { historyError } from './common.js';
import { ARCHIVE_CHUNK_VERSION, archiveStructuralSpans } from './archive-structure.js';
export const HISTORY_SEMANTIC_CHUNKER_VERSION = ARCHIVE_CHUNK_VERSION;
export function normalizeHistoryVector(value, dimensions) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== dimensions) {
    throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Invalid semantic vector.');
  }
  for (const item of value) if (!Number.isFinite(item)) {
    throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Invalid semantic vector.');
  }
  const norm = Math.hypot(...value);
  if (!Number.isFinite(norm) || norm === 0) throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Invalid semantic vector norm.');
  return Array.from(value, item => item / norm);
}
export function* historySemanticSpans(text, chunkChars, overlapChars, metadata = {}) {
  const spans = archiveStructuralSpans(text, { ...metadata, chunkChars, overlapChars });
  if (spans.length > 5000) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Semantic unit span budget exceeded.');
  yield* spans;
}

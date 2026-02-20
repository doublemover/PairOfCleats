import { estimateJsonBytes } from '../../shared/cache.js';
import { coerceNonNegativeInt, coercePositiveInt } from '../../shared/number-coerce.js';

/**
 * Validate and normalize postings payload metadata.
 * Rows must be positive; bytes may be zero when payload content is empty.
 *
 * @param {object|null|undefined} payload
 * @returns {{rows:number,bytes:number}|null}
 */
export const normalizePostingsPayloadMetadata = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const rows = coercePositiveInt(payload.rows);
  const bytes = coerceNonNegativeInt(payload.bytes);
  if (!rows || bytes == null) return null;
  return { rows, bytes };
};

/**
 * Estimate rows/bytes for postings payload scheduling.
 * `bytes` is an approximation used for queue/backpressure heuristics.
 *
 * @param {{chunks?:Array<object>,fileRelations?:object|null,vfsManifestRows?:Array<object>|null}} input
 * @returns {{rows:number,bytes:number}}
 */
export const buildPostingsPayloadMetadata = ({
  chunks,
  fileRelations,
  vfsManifestRows
}) => {
  const rows = Array.isArray(chunks) ? Math.max(1, chunks.length) : 1;
  const chunkBytes = Array.isArray(chunks) ? estimateJsonBytes(chunks) : 0;
  const relationBytes = fileRelations ? estimateJsonBytes(fileRelations) : 0;
  const vfsBytes = Array.isArray(vfsManifestRows) ? estimateJsonBytes(vfsManifestRows) : 0;
  const bytes = Math.max(0, Math.floor(chunkBytes + relationBytes + vfsBytes));
  return { rows, bytes };
};

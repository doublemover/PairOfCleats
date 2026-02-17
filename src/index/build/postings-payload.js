import { estimateJsonBytes } from '../../shared/cache.js';

const coercePositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const coerceNonNegativeInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

export const normalizePostingsPayloadMetadata = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const rows = coercePositiveInt(payload.rows);
  const bytes = coerceNonNegativeInt(payload.bytes);
  if (!rows || bytes == null) return null;
  return { rows, bytes };
};

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

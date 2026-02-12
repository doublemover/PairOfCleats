import path from 'node:path';

const METRICS = new Set(['cosine', 'l2', 'dot']);

const normalizeText = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
};

const normalizeInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const normalizeMetric = (value) => {
  if (typeof value !== 'string') return 'cosine';
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'ip') return 'dot';
  return METRICS.has(trimmed) ? trimmed : 'cosine';
};

const normalizeOptionalBoolean = (value) => {
  if (typeof value !== 'boolean') return null;
  return value;
};

export function normalizeLanceDbConfig(raw = {}) {
  if (raw === false) return { enabled: false };
  const config = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: config.enabled !== false,
    isolate: normalizeOptionalBoolean(config.isolate),
    table: normalizeText(config.table, 'vectors'),
    embeddingColumn: normalizeText(config.embeddingColumn, 'vector'),
    idColumn: normalizeText(config.idColumn, 'id'),
    metric: normalizeMetric(config.metric),
    batchSize: normalizeInt(config.batchSize, 1024)
  };
}

export function resolveLanceDbPaths(indexDir) {
  return {
    merged: {
      dir: path.join(indexDir, 'dense_vectors.lancedb'),
      metaPath: path.join(indexDir, 'dense_vectors.lancedb.meta.json')
    },
    doc: {
      dir: path.join(indexDir, 'dense_vectors_doc.lancedb'),
      metaPath: path.join(indexDir, 'dense_vectors_doc.lancedb.meta.json')
    },
    code: {
      dir: path.join(indexDir, 'dense_vectors_code.lancedb'),
      metaPath: path.join(indexDir, 'dense_vectors_code.lancedb.meta.json')
    }
  };
}

export function resolveLanceDbTarget(mode, denseVectorMode) {
  const resolved = typeof denseVectorMode === 'string'
    ? denseVectorMode.trim().toLowerCase()
    : '';
  if (resolved === 'code') return 'code';
  if (resolved === 'doc') return 'doc';
  if (resolved === 'auto') {
    if (mode === 'code') return 'code';
    if (mode === 'prose' || mode === 'extracted-prose') return 'doc';
  }
  return 'merged';
}

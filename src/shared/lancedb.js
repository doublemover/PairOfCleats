import path from 'node:path';
import fs from 'node:fs';

const METRICS = new Set(['cosine', 'l2', 'dot']);

/** Bounded, non-loading admission for the table files emitted by this backend.
 * This proves declared payload presence/type, not native decoding of its bytes.
 */
export const assertLanceDbPayload = (dir, { table = 'vectors', count = 0 } = {}) => {
  if (typeof table !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(table) || ['.', '..'].includes(table)) {
    throw new Error('LanceDB table name is not a safe local dataset name.');
  }
  const assertDirectory = target => {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`LanceDB payload is not a regular directory: ${target}`);
  };
  const hasNonemptyFile = (target, suffix) => {
    assertDirectory(target);
    const handle = fs.opendirSync(target);
    try {
      for (;;) {
        const entry = handle.readSync();
        if (!entry) return false;
        if (!entry.isFile() || !entry.name.endsWith(suffix)) continue;
        const stat = fs.lstatSync(path.join(target, entry.name));
        if (stat.isFile() && !stat.isSymbolicLink() && stat.size > 0) return true;
      }
    } finally { handle.closeSync(); }
  };
  assertDirectory(dir);
  const dataset = path.join(dir, `${table}.lance`);
  assertDirectory(dataset);
  if (!hasNonemptyFile(path.join(dataset, '_versions'), '.manifest')) {
    throw new Error('LanceDB table has no nonempty version manifest.');
  }
  if (count > 0 && !hasNonemptyFile(path.join(dataset, 'data'), '.lance')) {
    throw new Error('LanceDB table has no nonempty data fragments.');
  }
};

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

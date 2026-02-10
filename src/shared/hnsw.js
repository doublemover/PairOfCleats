import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { distanceToSimilarity } from './ann-similarity.js';

const require = createRequire(import.meta.url);

let warnedLoadFailure = false;

const warnLoadFailure = (message) => {
  if (warnedLoadFailure) return;
  warnedLoadFailure = true;
  console.warn(`[ann] HNSW index load failed; falling back to JS ANN. ${message || ''}`.trim());
};

const resolveHnswLib = () => {
  try {
    return require('hnswlib-node');
  } catch {
    return null;
  }
};

const getBakPath = (filePath) => `${filePath}.bak`;

const resolveIndexCandidates = (indexPath) => {
  if (!indexPath) return [];
  const candidates = [];
  if (fs.existsSync(indexPath)) {
    candidates.push({ path: indexPath, cleanup: true });
  }
  const bakPath = getBakPath(indexPath);
  if (fs.existsSync(bakPath)) {
    candidates.push({ path: bakPath, cleanup: false });
  }
  return candidates;
};

const cleanupBak = (indexPath) => {
  const bakPath = getBakPath(indexPath);
  if (!fs.existsSync(bakPath)) return;
  try {
    fs.rmSync(bakPath, { force: true });
  } catch {}
};

const SPACES = new Set(['cosine', 'l2', 'ip']);

const normalizeInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const normalizeSpace = (value) => {
  if (typeof value !== 'string') return 'cosine';
  const trimmed = value.trim().toLowerCase();
  return SPACES.has(trimmed) ? trimmed : 'cosine';
};

export function normalizeHnswConfig(raw = {}) {
  if (raw === false) return { enabled: false };
  const config = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: config.enabled !== false,
    space: normalizeSpace(config.space),
    m: normalizeInt(config.m, 16),
    efConstruction: normalizeInt(config.efConstruction, 200),
    efSearch: normalizeInt(config.efSearch, 64),
    randomSeed: normalizeInt(config.randomSeed, 100),
    allowReplaceDeleted: config.allowReplaceDeleted === true
  };
}

export function resolveHnswPaths(indexDir, target = 'merged') {
  const resolveTarget = (value) => {
    if (typeof value !== 'string') return 'merged';
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'doc') return 'doc';
    if (trimmed === 'code') return 'code';
    return 'merged';
  };
  const resolvedTarget = resolveTarget(target);
  if (resolvedTarget === 'doc') {
    return {
      indexPath: path.join(indexDir, 'dense_vectors_doc_hnsw.bin'),
      metaPath: path.join(indexDir, 'dense_vectors_doc_hnsw.meta.json')
    };
  }
  if (resolvedTarget === 'code') {
    return {
      indexPath: path.join(indexDir, 'dense_vectors_code_hnsw.bin'),
      metaPath: path.join(indexDir, 'dense_vectors_code_hnsw.meta.json')
    };
  }
  return {
    indexPath: path.join(indexDir, 'dense_vectors_hnsw.bin'),
    metaPath: path.join(indexDir, 'dense_vectors_hnsw.meta.json')
  };
}

export function resolveHnswTarget(mode, denseVectorMode) {
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

export function loadHnswIndex({ indexPath, dims, config, meta, expectedModel = null }) {
  const candidates = resolveIndexCandidates(indexPath);
  if (!candidates.length) return null;
  const metaDims = Number.isFinite(meta?.dims) ? meta.dims : null;
  const resolvedDims = Number.isFinite(dims) ? dims : metaDims;
  if (!Number.isFinite(resolvedDims) || resolvedDims <= 0) return null;
  if (metaDims != null && Number.isFinite(dims) && metaDims !== dims) {
    warnLoadFailure('(meta dims mismatch)');
    return null;
  }
  const normalized = normalizeHnswConfig(config);
  if (!normalized.enabled) return null;
  const metaSpace = meta?.space ? normalizeSpace(meta.space) : null;
  const configSpace = normalizeSpace(normalized.space);
  if (metaSpace && metaSpace !== configSpace) {
    warnLoadFailure('(meta space mismatch)');
    return null;
  }
  if (expectedModel && meta?.model && meta.model !== expectedModel) {
    warnLoadFailure('(meta model mismatch)');
    return null;
  }
  const lib = resolveHnswLib();
  const HNSW = lib?.HierarchicalNSW || lib?.default?.HierarchicalNSW || lib?.default;
  if (!HNSW) return null;
  const resolvedSpace = metaSpace || configSpace;
  let lastErr = null;
  for (const candidate of candidates) {
    const index = new HNSW(resolvedSpace, resolvedDims);
    try {
      const read = index.readIndexSync;
      if (typeof read !== 'function') {
        throw new Error('readIndexSync unavailable');
      }
      if (read.length <= 1) {
        read.call(index, candidate.path);
      } else {
        read.call(index, candidate.path, normalized.allowReplaceDeleted);
      }
    } catch (err) {
      lastErr = err;
      continue;
    }
    if (normalized.efSearch) {
      index.setEf(normalized.efSearch);
    }
    if (candidate.cleanup) cleanupBak(indexPath);
    return index;
  }
  warnLoadFailure(lastErr?.message ? `(${lastErr.message})` : '');
  return null;
}

export function rankHnswIndex({ index, space }, queryEmbedding, topN, candidateSet) {
  if (candidateSet && candidateSet.size === 0) return [];
  const isVectorLike = Array.isArray(queryEmbedding)
    || (ArrayBuffer.isView(queryEmbedding) && !(queryEmbedding instanceof DataView));
  if (!index || !isVectorLike || !queryEmbedding.length) return [];
  const requested = Math.max(1, Number(topN) || 1);
  const maxElements = typeof index.getCurrentCount === 'function'
    ? index.getCurrentCount()
    : (typeof index.getMaxElements === 'function'
      ? index.getMaxElements()
      : index.maxElements);
  const cap = Number.isFinite(maxElements) && maxElements > 0
    ? Math.min(requested, Math.floor(maxElements))
    : requested;
  // No explicit candidate-set cap; limit is bounded by candidate set size and topN.
  const limit = candidateSet && candidateSet.size
    ? Math.max(1, Math.min(cap, candidateSet.size))
    : cap;
  const filter = candidateSet && candidateSet.size
    ? (label) => candidateSet.has(label)
    : undefined;
  const queryVec = Array.isArray(queryEmbedding) ? queryEmbedding : Array.from(queryEmbedding);
  const result = index.searchKnn(queryVec, limit, filter);
  const distances = result?.distances || [];
  const neighbors = result?.neighbors || [];
  const hits = [];
  for (let i = 0; i < neighbors.length; i += 1) {
    const idx = neighbors[i];
    if (idx == null) continue;
    const distance = distances[i];
    const sim = distanceToSimilarity(distance, space);
    if (!Number.isFinite(sim)) continue;
    hits.push({ idx, sim });
  }
  return hits.sort((a, b) => (b.sim - a.sim) || (a.idx - b.idx));
}

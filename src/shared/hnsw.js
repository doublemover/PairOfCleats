import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const parseNodeMajor = () => {
  const raw = process.versions?.node || '';
  const major = Number(String(raw).split('.')[0]);
  return Number.isFinite(major) ? major : null;
};

const supportsHnswRuntime = () => {
  const major = parseNodeMajor();
  if (!Number.isFinite(major)) return true;
  return major < 24;
};

let warnedRuntimeUnsupported = false;
let warnedLoadFailure = false;
const warnRuntimeUnsupported = () => {
  if (warnedRuntimeUnsupported) return;
  warnedRuntimeUnsupported = true;
  console.warn(`[ann] HNSW disabled on Node ${process.versions.node}; use Node 20/22 or disable embeddings.hnsw.`);
};

const warnLoadFailure = (message) => {
  if (warnedLoadFailure) return;
  warnedLoadFailure = true;
  console.warn(`[ann] HNSW index load failed; falling back to JS ANN. ${message || ''}`.trim());
};

const resolveHnswLib = () => {
  if (!supportsHnswRuntime()) {
    warnRuntimeUnsupported();
    return null;
  }
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

export function resolveHnswPaths(indexDir) {
  return {
    indexPath: path.join(indexDir, 'dense_vectors_hnsw.bin'),
    metaPath: path.join(indexDir, 'dense_vectors_hnsw.meta.json')
  };
}

export function loadHnswIndex({ indexPath, dims, config, meta }) {
  const candidates = resolveIndexCandidates(indexPath);
  if (!candidates.length) return null;
  const resolvedDims = Number.isFinite(dims)
    ? dims
    : (Number.isFinite(meta?.dims) ? meta.dims : null);
  if (!Number.isFinite(resolvedDims) || resolvedDims <= 0) return null;
  if (Number.isFinite(meta?.dims) && Number.isFinite(dims) && meta.dims !== dims) {
    warnLoadFailure('(meta dims mismatch)');
    return null;
  }
  const normalized = normalizeHnswConfig(config);
  if (!normalized.enabled) return null;
  const lib = resolveHnswLib();
  const HNSW = lib?.HierarchicalNSW || lib?.default?.HierarchicalNSW || lib?.default;
  if (!HNSW) return null;
  const resolvedSpace = typeof meta?.space === 'string' ? meta.space : normalized.space;
  let lastErr = null;
  for (const candidate of candidates) {
    const index = new HNSW(resolvedSpace, resolvedDims);
    try {
      index.readIndexSync(candidate.path, normalized.allowReplaceDeleted);
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
    const sim = space === 'l2' ? -distance : 1 - distance;
    hits.push({ idx, sim });
  }
  return hits.sort((a, b) => (b.sim - a.sim) || (a.idx - b.idx));
}

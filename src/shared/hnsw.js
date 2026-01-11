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

const resolveIndexPath = (indexPath) => {
  if (!indexPath) return null;
  if (fs.existsSync(indexPath)) {
    return { path: indexPath, cleanup: true };
  }
  const bakPath = getBakPath(indexPath);
  if (fs.existsSync(bakPath)) {
    return { path: bakPath, cleanup: false };
  }
  return null;
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

export function loadHnswIndex({ indexPath, dims, config }) {
  const resolved = resolveIndexPath(indexPath);
  if (!resolved) return null;
  if (!Number.isFinite(dims) || dims <= 0) return null;
  const normalized = normalizeHnswConfig(config);
  if (!normalized.enabled) return null;
  const lib = resolveHnswLib();
  const HNSW = lib?.HierarchicalNSW || lib?.default?.HierarchicalNSW || lib?.default;
  if (!HNSW) return null;
  const index = new HNSW(normalized.space, dims);
  try {
    index.readIndexSync(resolved.path, normalized.allowReplaceDeleted);
  } catch (err) {
    warnLoadFailure(err?.message ? `(${err.message})` : '');
    return null;
  }
  if (normalized.efSearch) {
    index.setEf(normalized.efSearch);
  }
  if (resolved.cleanup) cleanupBak(indexPath);
  return index;
}

export function rankHnswIndex({ index, space }, queryEmbedding, topN, candidateSet) {
  if (!index || !Array.isArray(queryEmbedding) || !queryEmbedding.length) return [];
  const requested = Math.max(1, Number(topN) || 1);
  const maxElements = typeof index.getCurrentCount === 'function'
    ? index.getCurrentCount()
    : (typeof index.getMaxElements === 'function'
      ? index.getMaxElements()
      : index.maxElements);
  const cap = Number.isFinite(maxElements) && maxElements > 0
    ? Math.min(requested, Math.floor(maxElements))
    : requested;
  const limit = candidateSet && candidateSet.size
    ? Math.max(1, Math.min(cap, candidateSet.size))
    : cap;
  const filter = candidateSet && candidateSet.size
    ? (label) => candidateSet.has(label)
    : undefined;
  const result = index.searchKnn(queryEmbedding, limit, filter);
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

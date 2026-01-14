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
let warnedFallbackUsed = false;
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

const warnFallbackUsed = (message) => {
  if (warnedFallbackUsed) return;
  warnedFallbackUsed = true;
  console.warn(`[ann] HNSW primary index unreadable; using backup. ${message || ''}`.trim());
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

export function validateHnswMetaCompatibility({ denseVectors, hnswMeta } = {}) {
  const warnings = [];
  if (!denseVectors || !hnswMeta) {
    return { ok: true, warnings };
  }
  const vecDims = Number(denseVectors.dims);
  const metaDims = Number(hnswMeta.dims);
  if (Number.isFinite(vecDims) && Number.isFinite(metaDims) && vecDims !== metaDims) {
    warnings.push(`dims mismatch (vectors=${vecDims}, meta=${metaDims})`);
  }
  const vecModel = typeof denseVectors.model === 'string' ? denseVectors.model : null;
  const metaModel = typeof hnswMeta.model === 'string' ? hnswMeta.model : null;
  if (vecModel && metaModel && vecModel !== metaModel) {
    warnings.push(`model mismatch (vectors=${vecModel}, meta=${metaModel})`);
  }
  const vecCount = Array.isArray(denseVectors.vectors) ? denseVectors.vectors.length : null;
  const metaCount = Number(hnswMeta.count);
  if (Number.isFinite(metaCount) && metaCount >= 0 && Number.isFinite(vecCount) && vecCount !== metaCount) {
    warnings.push(`count mismatch (vectors=${vecCount}, meta=${metaCount})`);
  }
  const metaSpace = typeof hnswMeta.space === 'string' ? hnswMeta.space.trim().toLowerCase() : null;
  if (metaSpace && !SPACES.has(metaSpace)) {
    warnings.push(`space invalid (meta=${metaSpace})`);
  }
  return { ok: warnings.length === 0, warnings };
}

export function loadHnswIndex({ indexPath, dims, config, lib } = {}) {
  const resolved = resolveIndexPath(indexPath);
  if (!resolved) return null;
  if (!Number.isFinite(dims) || dims <= 0) return null;
  const normalized = normalizeHnswConfig(config);
  if (!normalized.enabled) return null;
  const resolvedLib = lib || resolveHnswLib();
  const HNSW = resolvedLib?.HierarchicalNSW || resolvedLib?.default?.HierarchicalNSW || resolvedLib?.default;
  if (!HNSW) return null;
  const buildIndex = () => new HNSW(normalized.space, dims);
  const applyEfSearch = (index) => {
    if (!normalized.efSearch) return;
    try {
      index.setEf(normalized.efSearch);
    } catch {}
  };
  const tryLoad = (candidatePath) => {
    const index = buildIndex();
    index.readIndexSync(candidatePath, normalized.allowReplaceDeleted);
    applyEfSearch(index);
    return index;
  };

  try {
    const index = tryLoad(resolved.path);
    if (resolved.cleanup) cleanupBak(indexPath);
    return index;
  } catch (err) {
    // If the primary file exists but is unreadable/corrupt, fall back to the
    // backup if available. This avoids hard failures when a prior atomic
    // replace left a valid .bak behind.
    const primaryPath = indexPath;
    const bakPath = getBakPath(indexPath);
    const altPath = resolved.path === primaryPath ? bakPath : primaryPath;
    if (altPath && altPath !== resolved.path && fs.existsSync(altPath)) {
      try {
        const index = tryLoad(altPath);
        warnFallbackUsed(path.basename(altPath));
        return index;
      } catch (altErr) {
        warnLoadFailure(altErr?.message ? `(${altErr.message})` : '');
        return null;
      }
    }
    warnLoadFailure(err?.message ? `(${err.message})` : '');
    return null;
  }
}

export function rankHnswIndex({ index, space }, queryEmbedding, topN, candidateSet) {
  const embedding = Array.isArray(queryEmbedding)
    ? queryEmbedding
    : (ArrayBuffer.isView(queryEmbedding) ? Array.from(queryEmbedding) : null);
  if (!index || !embedding || !embedding.length) return [];
  // If a candidate set is provided but empty, the correct answer is an empty
  // hit list (consistent with other rankers) rather than an unfiltered search.
  if (candidateSet && typeof candidateSet.size === 'number' && candidateSet.size === 0) return [];
  const requested = Math.max(1, Number(topN) || 1);
  const maxElements = typeof index.getCurrentCount === 'function'
    ? index.getCurrentCount()
    : (typeof index.getMaxElements === 'function'
      ? index.getMaxElements()
      : index.maxElements);
  const cap = Number.isFinite(maxElements) && maxElements > 0
    ? Math.min(requested, Math.floor(maxElements))
    : requested;
  const limit = candidateSet && typeof candidateSet.size === 'number'
    ? Math.max(1, Math.min(cap, candidateSet.size))
    : cap;
  const filter = candidateSet && typeof candidateSet.size === 'number'
    ? (label) => candidateSet.has(label)
    : undefined;
  const result = index.searchKnn(embedding, limit, filter);
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

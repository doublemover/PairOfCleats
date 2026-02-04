import fsSync from 'node:fs';
import path from 'node:path';
import { LRUCache } from 'lru-cache';
import { incCacheEviction, setCacheSize } from '../shared/metrics.js';

const DEFAULT_INDEX_CACHE_MAX_ENTRIES = 4;
const DEFAULT_INDEX_CACHE_TTL_MS = 15 * 60 * 1000;
const indexSignatureCache = new Map();

const INDEX_FILES = [
  'phrase_ngrams.json',
  'chargram_postings.json',
  'dense_vectors_uint8.json',
  'dense_vectors_doc_uint8.json',
  'dense_vectors_code_uint8.json',
  'dense_vectors_hnsw.meta.json',
  'dense_vectors_hnsw.bin',
  'dense_vectors_doc_hnsw.meta.json',
  'dense_vectors_doc_hnsw.bin',
  'dense_vectors_code_hnsw.meta.json',
  'dense_vectors_code_hnsw.bin',
  'dense_vectors.lancedb.meta.json',
  'dense_vectors_doc.lancedb.meta.json',
  'dense_vectors_code.lancedb.meta.json',
  'field_postings.json',
  'field_tokens.json',
  'minhash_signatures.json',
  'file_meta.json',
  'filter_index.json',
  'index_state.json'
];

const indexStateSignature = (dir) => {
  if (!dir) return null;
  const statePath = path.join(dir, 'index_state.json');
  try {
    const raw = fsSync.readFileSync(statePath, 'utf8');
    const state = JSON.parse(raw);
    if (state && typeof state === 'object') {
      const buildId = typeof state.buildId === 'string' ? state.buildId : '';
      const mode = typeof state.mode === 'string' ? state.mode : '';
      const surface = typeof state.artifactSurfaceVersion === 'string' ? state.artifactSurfaceVersion : '';
      if (buildId || mode || surface) {
        return `build:${buildId || 'missing'}|mode:${mode || 'missing'}|surface:${surface || 'missing'}`;
      }
    }
  } catch {}
  const statSig = fileSignature(statePath);
  return statSig ? `stat:${statSig}` : null;
};

const fileSignature = (filePath) => {
  try {
    let statPath = filePath;
    if (!fsSync.existsSync(statPath) && filePath.endsWith('.json')) {
      const zstPath = `${filePath}.zst`;
      const gzPath = `${filePath}.gz`;
      if (fsSync.existsSync(zstPath)) {
        statPath = zstPath;
      } else if (fsSync.existsSync(gzPath)) {
        statPath = gzPath;
      }
    }
    // Prefer nanosecond mtime precision when available so that successive writes within the
    // same millisecond still invalidate the cache (observed on Windows runners).
    try {
      const stat = fsSync.statSync(statPath, { bigint: true });
      const size = typeof stat.size === 'bigint' ? stat.size : BigInt(stat.size);
      const mtimeNs = stat.mtimeNs
        ?? (typeof stat.mtimeMs === 'bigint'
          ? stat.mtimeMs * 1000000n
          : BigInt(Math.trunc(Number(stat.mtimeMs) * 1_000_000)));
      const ctimeNs = stat.ctimeNs
        ?? (typeof stat.ctimeMs === 'bigint'
          ? stat.ctimeMs * 1000000n
          : BigInt(Math.trunc(Number(stat.ctimeMs) * 1_000_000)));
      return `${size.toString()}:${mtimeNs.toString()}:${ctimeNs.toString()}`;
    } catch {
      const stat = fsSync.statSync(statPath);
      return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    }
  } catch {
    return null;
  }
};

const shardSignature = (dir, prefix) => {
  try {
    if (!fsSync.existsSync(dir)) return null;
    const entries = fsSync
      .readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .sort();
    if (!entries.length) return null;
    return entries
      .map((name) => fileSignature(path.join(dir, name)) || 'missing')
      .join(',');
  } catch {
    return null;
  }
};

const chunkMetaSignature = (dir) => {
  const jsonPath = path.join(dir, 'chunk_meta.json');
  const jsonSig = fileSignature(jsonPath);
  if (jsonSig) return `chunk_meta.json:${jsonSig}`;
  const jsonlPath = path.join(dir, 'chunk_meta.jsonl');
  const jsonlSig = fileSignature(jsonlPath);
  if (jsonlSig) return `chunk_meta.jsonl:${jsonlSig}`;
  const metaPath = path.join(dir, 'chunk_meta.meta.json');
  const metaSig = fileSignature(metaPath);
  const partsSig = shardSignature(path.join(dir, 'chunk_meta.parts'), 'chunk_meta.part-');
  if (metaSig || partsSig) {
    return `chunk_meta.meta.json:${metaSig || 'missing'}|parts:${partsSig || 'missing'}`;
  }
  return 'chunk_meta.json:missing';
};

const tokenPostingsSignature = (dir) => {
  const packedPath = path.join(dir, 'token_postings.packed.bin');
  const packedSig = fileSignature(packedPath);
  if (packedSig) {
    const offsetsSig = fileSignature(path.join(dir, 'token_postings.packed.offsets.bin'));
    const metaSig = fileSignature(path.join(dir, 'token_postings.packed.meta.json'));
    return `token_postings.packed.bin:${packedSig}|offsets:${offsetsSig || 'missing'}|meta:${metaSig || 'missing'}`;
  }
  const jsonPath = path.join(dir, 'token_postings.json');
  const jsonSig = fileSignature(jsonPath);
  if (jsonSig) return `token_postings.json:${jsonSig}`;
  const metaPath = path.join(dir, 'token_postings.meta.json');
  const metaSig = fileSignature(metaPath);
  const partsSig = shardSignature(path.join(dir, 'token_postings.shards'), 'token_postings.part-');
  if (metaSig || partsSig) {
    return `token_postings.meta.json:${metaSig || 'missing'}|parts:${partsSig || 'missing'}`;
  }
  return 'token_postings.json:missing';
};

const jsonlArtifactSignature = (dir, baseName) => {
  const jsonPath = path.join(dir, `${baseName}.json`);
  const jsonSig = fileSignature(jsonPath);
  if (jsonSig) return `${baseName}.json:${jsonSig}`;
  const jsonlPath = path.join(dir, `${baseName}.jsonl`);
  const jsonlSig = fileSignature(jsonlPath);
  if (jsonlSig) return `${baseName}.jsonl:${jsonlSig}`;
  const metaPath = path.join(dir, `${baseName}.meta.json`);
  const metaSig = fileSignature(metaPath);
  const partsSig = shardSignature(path.join(dir, `${baseName}.parts`), `${baseName}.part-`);
  if (metaSig || partsSig) {
    return `${baseName}.meta.json:${metaSig || 'missing'}|parts:${partsSig || 'missing'}`;
  }
  return `${baseName}.json:missing`;
};

export function buildIndexSignature(dir) {
  if (!dir) return null;
  const stateSig = indexStateSignature(dir);
  if (stateSig) {
    const cacheKey = `${dir}|${stateSig}`;
    const cached = indexSignatureCache.get(cacheKey);
    if (cached) return cached;
    const signature = `index_state:${stateSig}`;
    indexSignatureCache.set(cacheKey, signature);
    return signature;
  }
  const parts = [
    chunkMetaSignature(dir),
    tokenPostingsSignature(dir),
    jsonlArtifactSignature(dir, 'file_relations'),
    jsonlArtifactSignature(dir, 'repo_map'),
    ...INDEX_FILES.map((name) => {
      const target = path.join(dir, name);
      const sig = fileSignature(target);
      return `${name}:${sig || 'missing'}`;
    })
  ];
  return parts.join('|');
}

export function createIndexCache({
  maxEntries = DEFAULT_INDEX_CACHE_MAX_ENTRIES,
  ttlMs = DEFAULT_INDEX_CACHE_TTL_MS,
  onEvict = null
} = {}) {
  const resolvedMax = Number.isFinite(Number(maxEntries)) ? Math.floor(Number(maxEntries)) : DEFAULT_INDEX_CACHE_MAX_ENTRIES;
  const resolvedTtlMs = Number.isFinite(Number(ttlMs)) ? Math.max(0, Number(ttlMs)) : DEFAULT_INDEX_CACHE_TTL_MS;
  if (!resolvedMax || resolvedMax <= 0) {
    return {
      get() {
        return null;
      },
      set() {},
      delete() {},
      clear() {},
      size: () => 0,
      cache: null
    };
  }
  const cache = new LRUCache({
    max: resolvedMax,
    ttl: resolvedTtlMs > 0 ? resolvedTtlMs : undefined,
    allowStale: false,
    updateAgeOnGet: true,
    dispose: (value, key, reason) => {
      if (typeof onEvict === 'function') {
        onEvict({ key, value, reason });
      }
      if (reason === 'evict' || reason === 'expire') {
        incCacheEviction({ cache: 'index' });
      }
      setCacheSize({ cache: 'index', value: cache.size });
    }
  });
  return {
    get(key) {
      const value = cache.get(key);
      return value ?? null;
    },
    set(key, value) {
      cache.set(key, value);
      setCacheSize({ cache: 'index', value: cache.size });
    },
    delete(key) {
      cache.delete(key);
      setCacheSize({ cache: 'index', value: cache.size });
    },
    clear() {
      cache.clear();
      setCacheSize({ cache: 'index', value: cache.size });
    },
    size: () => cache.size,
    cache
  };
}

export async function loadIndexWithCache(cache, dir, options, loader) {
  if (!cache) return loader(dir, options);
  const hnswKey = options?.includeHnsw ? JSON.stringify(options?.hnswConfig || {}) : 'no-hnsw';
  const denseKey = options?.denseVectorMode ? String(options.denseVectorMode) : '';
  const includeKey = [
    options?.includeDense !== false ? 'dense' : 'no-dense',
    options?.includeMinhash !== false ? 'minhash' : 'no-minhash',
    options?.includeFilterIndex !== false ? 'filter' : 'no-filter',
    options?.includeFileRelations !== false ? 'file-rel' : 'no-file-rel',
    options?.includeRepoMap !== false ? 'repo-map' : 'no-repo-map',
    options?.includeTokenIndex !== false ? 'token' : 'no-token'
  ].join(',');
  const cacheKey = `${dir}::${options?.modelIdDefault || ''}::${options?.fileChargramN || ''}::${hnswKey}::${denseKey}::${includeKey}`;
  const signature = buildIndexSignature(dir);
  const cached = cache.get(cacheKey);
  if (cached && cached.signature === signature) {
    return cached.value;
  }
  const value = await loader(dir, options);
  cache.set(cacheKey, { signature, value });
  return value;
}

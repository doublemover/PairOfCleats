import fs from 'node:fs/promises';
import path from 'node:path';
import { createLruCache } from '../shared/cache.js';
import { incCacheEviction, setCacheSize } from '../shared/metrics.js';

const DEFAULT_INDEX_CACHE_MAX_ENTRIES = 4;
const DEFAULT_INDEX_CACHE_TTL_MS = 15 * 60 * 1000;
export const INDEX_SIGNATURE_TTL_MS = 5 * 60 * 1000;
const INDEX_SIGNATURE_CACHE_MAX_ENTRIES = 256;
const indexSignatureCache = new Map();

const canonicalizeIndexDir = async (dir) => {
  const resolved = path.resolve(String(dir || ''));
  if (!resolved) return null;
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
};

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
  'minhash_signatures.packed.bin',
  'minhash_signatures.packed.meta.json',
  'file_meta.json',
  'filter_index.json',
  'index_state.json'
];

const pruneIndexSignatureCache = (now = Date.now()) => {
  for (const [key, value] of indexSignatureCache.entries()) {
    if (!value || typeof value !== 'object') {
      indexSignatureCache.delete(key);
      continue;
    }
    if (value.expiresAt && value.expiresAt <= now) {
      indexSignatureCache.delete(key);
    }
  }
  if (indexSignatureCache.size <= INDEX_SIGNATURE_CACHE_MAX_ENTRIES) return;
  const overflow = indexSignatureCache.size - INDEX_SIGNATURE_CACHE_MAX_ENTRIES;
  const oldest = Array.from(indexSignatureCache.entries())
    .sort((a, b) => (a[1]?.lastAccessAt || 0) - (b[1]?.lastAccessAt || 0))
    .slice(0, overflow);
  for (const [key] of oldest) {
    indexSignatureCache.delete(key);
  }
};

const getCachedSignature = (cacheKey) => {
  if (!cacheKey) return null;
  const now = Date.now();
  pruneIndexSignatureCache(now);
  const cached = indexSignatureCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt && cached.expiresAt <= now) {
    indexSignatureCache.delete(cacheKey);
    return null;
  }
  cached.lastAccessAt = now;
  return cached.signature || null;
};

const setCachedSignature = (cacheKey, signature) => {
  if (!cacheKey || !signature) return;
  const now = Date.now();
  indexSignatureCache.set(cacheKey, {
    signature,
    expiresAt: now + INDEX_SIGNATURE_TTL_MS,
    lastAccessAt: now
  });
  pruneIndexSignatureCache(now);
};

const safeStat = async (statPath, useBigInt) => {
  try {
    return await fs.stat(statPath, useBigInt ? { bigint: true } : undefined);
  } catch {
    return null;
  }
};

const indexStateSignature = async (dir) => {
  if (!dir) return null;
  const statePath = path.join(dir, 'index_state.json');
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const state = JSON.parse(raw);
    if (state && typeof state === 'object') {
      const buildId = typeof state.buildId === 'string' ? state.buildId : '';
      const mode = typeof state.mode === 'string' ? state.mode : '';
      const surface = typeof state.artifactSurfaceVersion === 'string' ? state.artifactSurfaceVersion : '';
      if (buildId || mode || surface) {
        return {
          signature: `build:${buildId || 'missing'}|mode:${mode || 'missing'}|surface:${surface || 'missing'}`,
          buildId: buildId || null
        };
      }
    }
  } catch {}
  const statSig = await fileSignature(statePath);
  return statSig ? { signature: `stat:${statSig}`, buildId: null } : null;
};

const fileSignature = async (filePath) => {
  try {
    let statPath = filePath;
    let stat = await safeStat(statPath, true);
    if (!stat && !filePath.endsWith('.gz') && !filePath.endsWith('.zst')) {
      const zstPath = `${filePath}.zst`;
      stat = await safeStat(zstPath, true);
      if (stat) {
        statPath = zstPath;
      } else {
        const gzPath = `${filePath}.gz`;
        stat = await safeStat(gzPath, true);
        if (stat) statPath = gzPath;
      }
    }
    // Prefer nanosecond mtime precision when available so that successive writes within the
    // same millisecond still invalidate the cache (observed on Windows runners).
    if (!stat) stat = await safeStat(statPath, false);
    if (!stat) return null;
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
    return null;
  }
};

const shardSignature = async (dir, prefix) => {
  try {
    const entries = (await fs.readdir(dir))
      .filter((name) => name.startsWith(prefix))
      .sort();
    if (!entries.length) return null;
    const sigs = await Promise.all(
      entries.map((name) => fileSignature(path.join(dir, name)))
    );
    return sigs.map((sig) => sig || 'missing').join(',');
  } catch {
    return null;
  }
};

const binaryColumnarSignature = async (dir, baseName) => {
  const metaName = `${baseName}.binary-columnar.meta.json`;
  const metaSig = await fileSignature(path.join(dir, metaName));
  if (!metaSig) return null;
  const dataSig = await fileSignature(path.join(dir, `${baseName}.binary-columnar.bin`));
  const offsetsSig = await fileSignature(path.join(dir, `${baseName}.binary-columnar.offsets.bin`));
  const lengthsSig = await fileSignature(path.join(dir, `${baseName}.binary-columnar.lengths.varint`));
  return `${metaName}:${metaSig}|data:${dataSig || 'missing'}|offsets:${offsetsSig || 'missing'}|lengths:${lengthsSig || 'missing'}`;
};

const chunkMetaSignature = async (dir) => {
  const jsonPath = path.join(dir, 'chunk_meta.json');
  const jsonSig = await fileSignature(jsonPath);
  if (jsonSig) return `chunk_meta.json:${jsonSig}`;
  const jsonlPath = path.join(dir, 'chunk_meta.jsonl');
  const jsonlSig = await fileSignature(jsonlPath);
  if (jsonlSig) return `chunk_meta.jsonl:${jsonlSig}`;
  const columnarPath = path.join(dir, 'chunk_meta.columnar.json');
  const columnarSig = await fileSignature(columnarPath);
  if (columnarSig) return `chunk_meta.columnar.json:${columnarSig}`;
  const binarySig = await binaryColumnarSignature(dir, 'chunk_meta');
  if (binarySig) return binarySig;
  const metaPath = path.join(dir, 'chunk_meta.meta.json');
  const metaSig = await fileSignature(metaPath);
  const partsSig = await shardSignature(path.join(dir, 'chunk_meta.parts'), 'chunk_meta.part-');
  if (metaSig || partsSig) {
    return `chunk_meta.meta.json:${metaSig || 'missing'}|parts:${partsSig || 'missing'}`;
  }
  return 'chunk_meta.json:missing';
};

const tokenPostingsSignature = async (dir) => {
  const packedPath = path.join(dir, 'token_postings.packed.bin');
  const packedSig = await fileSignature(packedPath);
  if (packedSig) {
    const offsetsSig = await fileSignature(path.join(dir, 'token_postings.packed.offsets.bin'));
    const metaSig = await fileSignature(path.join(dir, 'token_postings.packed.meta.json'));
    return `token_postings.packed.bin:${packedSig}|offsets:${offsetsSig || 'missing'}|meta:${metaSig || 'missing'}`;
  }
  const jsonPath = path.join(dir, 'token_postings.json');
  const jsonSig = await fileSignature(jsonPath);
  if (jsonSig) return `token_postings.json:${jsonSig}`;
  const binarySig = await binaryColumnarSignature(dir, 'token_postings');
  if (binarySig) return binarySig;
  const metaPath = path.join(dir, 'token_postings.meta.json');
  const metaSig = await fileSignature(metaPath);
  const partsSig = await shardSignature(path.join(dir, 'token_postings.shards'), 'token_postings.part-');
  if (metaSig || partsSig) {
    return `token_postings.meta.json:${metaSig || 'missing'}|parts:${partsSig || 'missing'}`;
  }
  return 'token_postings.json:missing';
};

const jsonlArtifactSignature = async (dir, baseName) => {
  const jsonPath = path.join(dir, `${baseName}.json`);
  const jsonSig = await fileSignature(jsonPath);
  if (jsonSig) return `${baseName}.json:${jsonSig}`;
  const jsonlPath = path.join(dir, `${baseName}.jsonl`);
  const jsonlSig = await fileSignature(jsonlPath);
  if (jsonlSig) return `${baseName}.jsonl:${jsonlSig}`;
  const metaPath = path.join(dir, `${baseName}.meta.json`);
  const metaSig = await fileSignature(metaPath);
  const partsSig = await shardSignature(path.join(dir, `${baseName}.parts`), `${baseName}.part-`);
  if (metaSig || partsSig) {
    return `${baseName}.meta.json:${metaSig || 'missing'}|parts:${partsSig || 'missing'}`;
  }
  return `${baseName}.json:missing`;
};

export async function buildIndexSignature(dir) {
  if (!dir) return null;
  const canonicalDir = await canonicalizeIndexDir(dir);
  if (!canonicalDir) return null;
  const stateInfo = await indexStateSignature(canonicalDir);
  if (stateInfo?.signature) {
    const cacheKey = stateInfo.buildId
      ? `${canonicalDir}|build:${stateInfo.buildId}`
      : `${canonicalDir}|state:${stateInfo.signature}`;
    const cached = getCachedSignature(cacheKey);
    if (cached) return cached;
    const signature = `index_state:${stateInfo.signature}`;
    setCachedSignature(cacheKey, signature);
    return signature;
  }
  const [chunkMetaSig, tokenPostingsSig, fileRelationsSig, repoMapSig, ...fileSigs] = await Promise.all([
    chunkMetaSignature(canonicalDir),
    tokenPostingsSignature(canonicalDir),
    jsonlArtifactSignature(canonicalDir, 'file_relations'),
    jsonlArtifactSignature(canonicalDir, 'repo_map'),
    ...INDEX_FILES.map(async (name) => {
      const target = path.join(canonicalDir, name);
      const sig = await fileSignature(target);
      return `${name}:${sig || 'missing'}`;
    })
  ]);
  const signature = [
    chunkMetaSig,
    tokenPostingsSig,
    fileRelationsSig,
    repoMapSig,
    ...fileSigs
  ].join('|');
  return signature;
}

export function createIndexCache({
  maxEntries = DEFAULT_INDEX_CACHE_MAX_ENTRIES,
  ttlMs = DEFAULT_INDEX_CACHE_TTL_MS,
  onEvict = null
} = {}) {
  const cacheHandle = createLruCache({
    name: 'index',
    maxEntries,
    ttlMs,
    onEvict: ({ key, value, reason }) => {
      if (typeof onEvict === 'function') {
        onEvict({ key, value, reason });
      }
      if (reason === 'evict' || reason === 'expire') {
        incCacheEviction({ cache: 'index' });
      }
      setCacheSize({ cache: 'index', value: cacheHandle.size() });
    },
    onSizeChange: (size) => {
      setCacheSize({ cache: 'index', value: size });
    }
  });
  if (!cacheHandle.cache) {
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
  return {
    get(key) {
      return cacheHandle.get(key);
    },
    set(key, value) {
      cacheHandle.set(key, value);
    },
    delete(key) {
      cacheHandle.delete(key);
    },
    clear() {
      cacheHandle.clear();
    },
    size: cacheHandle.size,
    cache: cacheHandle.cache
  };
}

export async function loadIndexWithCache(cache, dir, options, loader) {
  if (!cache) return loader(dir, options);
  const resolvedDir = path.resolve(String(dir || ''));
  const canonicalDir = await fs.realpath(resolvedDir).catch(() => resolvedDir);
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
  const cacheKey = `${canonicalDir}::${options?.modelIdDefault || ''}::${options?.fileChargramN || ''}::${hnswKey}::${denseKey}::${includeKey}`;
  const signature = await buildIndexSignature(canonicalDir);
  const cached = cache.get(cacheKey);
  if (cached && cached.signature === signature) {
    return cached.value;
  }
  const value = await loader(canonicalDir, options);
  cache.set(cacheKey, { signature, value });
  return value;
}

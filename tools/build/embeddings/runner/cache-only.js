import path from 'node:path';
import { throwIfAborted, isAbortError } from '../../../../src/shared/abort.js';
import { canonicalBundleSourceKey } from '../../../../src/shared/bundle-source-key.js';
import { loadChunkMetaRows, loadFileMetaRows } from '../../../../src/shared/artifact-io/loaders.js';
import { embeddingArtifactReusable } from '../../../../src/shared/embedding-artifact-identity.js';
import { buildEmbeddingIdentityKey } from '../../../../src/shared/embedding-identity.js';
import { buildChunkSignature } from '../chunks.js';
import { createDeterministicFileStreamSampler, selectDeterministicFileSample } from '../sampling.js';
import { buildCacheKey, readCacheIndex, readCacheMeta, readCacheEntries, resolveCacheDir,
  resolveLegacyCacheDir, resolveGlobalChunkCacheDir, withEmbeddingCacheReadLock } from '../cache.js';
import { hydrateReferencedFileCache } from '../cache/file-references.js';
import { assertQuantizedEmbeddingRow, resolveEmbeddingQuantizationSpec } from '../../../../src/shared/embedding-quantization-spec.js';

const MAX_FILES = 2048;
const MAX_CHUNKS = 131072;
const MAX_VECTOR_BYTES = 64 * 1024 * 1024;
const invalidated = () => Object.assign(new Error('Validated cache-only coverage changed before publication. Retry Stage3 to resolve provider execution before reusing any cached rows.'), {
  code: 'ERR_EMBEDDING_CACHE_ONLY_INVALIDATED'
});

/** Validate complete channel presence as well as width. A deliberately absent
 * documentation channel is different from a missing required documentation row.
 * The payload remains borrowed; this check never mutates or detaches it. */
export const hasCompleteCachedFileVectors = ({ cached, items, dims }) => {
  if (!Number.isSafeInteger(dims) || dims <= 0 || !Array.isArray(items)) return false;
  let spec;
  try { spec = resolveEmbeddingQuantizationSpec(cached?.cacheMeta?.identity?.quantization); }
  catch { return false; }
  for (const channel of ['code', 'doc', 'merged']) {
    const rows = cached?.[`${channel}Vectors`];
    if (!Array.isArray(rows) || rows.length !== items.length) return false;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (!Array.isArray(row) && !(ArrayBuffer.isView(row) && !(row instanceof DataView))) return false;
      const hasDoc = typeof items[index]?.chunk?.docmeta?.doc === 'string' && Boolean(items[index].chunk.docmeta.doc.trim());
      if (channel === 'doc' && !hasDoc && row.length === 0) continue;
      if (row.length !== dims) return false;
      try { assertQuantizedEmbeddingRow(row, { spec, dims, allowEmpty: false }); }
      catch { return false; }
    }
  }
  return true;
};

/** This object has no model constructor or tokenizer. Inference after a proven
 * all-cache selection is an invalidation, never a late provider/fallback change. */
export const createCacheOnlyEmbedder = ({ identity, signal }) => {
  const refuse = async () => { throwIfAborted(signal); throw invalidated(); };
  return {
    getChunkEmbedding: refuse,
    getChunkEmbeddings: refuse,
    getActiveProvider: () => identity.provider,
    executionInfo: () => ({ provider: null, requestedProvider: identity.provider, loaded: false,
      loading: false, inferenceSucceeded: false, observedDims: null, cacheOnly: true,
      modelArtifact: identity.modelArtifact, effectiveNativeThreads: null }),
    dispose: async () => {}
  };
};

/** Bounded all-mode preflight. It retains one mode's compact chunk metadata and
 * one file's decoded payload, then drops both. Canonical artifact rows are the
 * only fast path; ambiguous/bundle-only input falls back to the ordinary probe.
 * No model import, cache writer, readiness override, or stat-only proof exists.
 */
export const planStage3CacheOnly = async ({ roots, identity, identityKey, cacheRoot, keyFlags,
  readManifest, readState, compactChunk, maxMetaBytes, sampling = {}, signal }) => {
  const work = { modesChecked: 0, filesChecked: 0, chunksChecked: 0, vectorBytesChecked: 0 };
  const refuse = reason => ({ eligible: false, reason, work });
  if (identity?.stub || !embeddingArtifactReusable(identity?.modelArtifact)
    || !Number.isSafeInteger(identity?.dims) || identity.dims <= 0
    || !identity.modelId || !identity.provider || !identity.pooling || !identity.inputFormatting
    || identityKey !== buildEmbeddingIdentityKey(identity)) return refuse('incomplete-identity');
  try {
    for (const [mode, indexRoot] of roots) {
      throwIfAborted(signal);
      if (!['code', 'prose', 'extracted-prose', 'records'].includes(mode)) return refuse('invalid-mode');
      const indexDir = path.join(indexRoot, `index-${mode}`);
      const manifestFiles = readManifest(mode)?.manifest?.files;
      if (!manifestFiles || typeof manifestFiles !== 'object') return refuse('missing-input-manifest');
      const repoId = readState(path.join(indexDir, 'index_state.json'))?.repoId || null;
      const chunks = new Map(), fileMeta = new Map();
      let fileMetaLoaded = false, nextIndex = 0, retainedChunks = 0;
      const sampler = sampling.maxFiles ? createDeterministicFileStreamSampler({ mode,
        maxFiles: sampling.maxFiles, seed: sampling.seed }) : null;
      for await (const row of loadChunkMetaRows(indexDir, { maxBytes: maxMetaBytes, strict: false, includeCold: false })) {
        throwIfAborted(signal);
        const index = nextIndex++;
        if (!row || typeof row !== 'object') return refuse('unmapped-chunk');
        let file = typeof row.file === 'string' && row.file ? row.file : null;
        if (!file && Number.isFinite(Number(row.fileId))) {
          if (!fileMetaLoaded) {
            for await (const value of loadFileMetaRows(indexDir, { maxBytes: maxMetaBytes, strict: false })) {
              throwIfAborted(signal);
              if (fileMeta.size >= MAX_FILES) return refuse('preflight-file-budget');
              if (value && Number.isFinite(Number(value.id)) && typeof value.file === 'string') fileMeta.set(Number(value.id), value.file);
            }
            fileMetaLoaded = true;
          }
          file = fileMeta.get(Number(row.fileId));
        }
        const normalized = canonicalBundleSourceKey(file);
        if (!normalized) return refuse('unmapped-chunk');
        if (sampler) {
          const decision = sampler.considerFile(normalized);
          if (decision.evicted) { retainedChunks -= chunks.get(decision.evicted)?.length || 0; chunks.delete(decision.evicted); }
          if (!decision.selected) continue;
        }
        if (retainedChunks >= MAX_CHUNKS || chunks.size >= MAX_FILES && !chunks.has(normalized)) return refuse('preflight-chunk-budget');
        const chunk = compactChunk(row, file);
        if (!chunk) return refuse('unmapped-chunk');
        const list = chunks.get(normalized) || [];
        list.push({ index, chunk }); chunks.set(normalized, list); retainedChunks++;
      }
      if (!nextIndex || !chunks.size) return refuse('no-cache-inputs');
      let entries = [...chunks.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      if (!sampler && sampling.maxFiles && sampling.maxFiles < entries.length) entries = selectDeterministicFileSample({
        fileEntries: entries, mode, maxFiles: sampling.maxFiles, seed: sampling.seed });
      const fileDir = resolveCacheDir(cacheRoot, identity, mode), legacyDir = resolveLegacyCacheDir(cacheRoot, identity, mode);
      const meta = await readCacheMeta(cacheRoot, identity, mode);
      if (meta?.identityKey && meta.identityKey !== identityKey) return refuse('cache-profile-mismatch');
      const index = await readCacheIndex(fileDir, identityKey, { strict: true });
      const legacy = legacyDir ? await readCacheIndex(legacyDir, identityKey, { strict: true }) : null;
      const globalDir = resolveGlobalChunkCacheDir(cacheRoot, identity);
      const globalIndex = await readCacheIndex(globalDir, identityKey, { strict: true });
      const fallbacks = legacyDir ? [{ cacheDir: legacyDir, cacheIndex: legacy, allowUnindexedStandalone: true }] : [];
      for (const [file, items] of entries) {
        throwIfAborted(signal);
        if (++work.filesChecked > MAX_FILES || work.chunksChecked + items.length > MAX_CHUNKS) return refuse('preflight-coverage-budget');
        const hash = manifestFiles[file]?.hash;
        if (typeof hash !== 'string' || !hash) return refuse('missing-source-hash');
        const signature = buildChunkSignature(items);
        const cacheKey = buildCacheKey({ file, hash, signature, identityKey, repoId, mode,
          featureFlags: keyFlags, pathPolicy: 'posix' });
        const result = (await readCacheEntries(fileDir, [cacheKey], index, { fallbacks }))[0];
        let cached = result?.entry;
        if (cached?.chunkReferences) cached = await withEmbeddingCacheReadLock(globalDir,
          () => hydrateReferencedFileCache({ entry: cached, identityKey, readChunks: keys => readCacheEntries(globalDir, keys, globalIndex) }),
          { waitMs: 0 });
        throwIfAborted(signal);
        if (cached?.key !== cacheKey || cached.hash !== hash || cached.chunkSignature !== signature
          || cached.cacheMeta?.identityKey !== identityKey
          || !hasCompleteCachedFileVectors({ cached, items, dims: identity.dims })) return refuse('missing-or-incomplete-file');
        for (const channel of ['code', 'doc', 'merged']) for (const vector of cached[`${channel}Vectors`]) work.vectorBytesChecked += vector.length;
        if (work.vectorBytesChecked > MAX_VECTOR_BYTES) return refuse('preflight-vector-budget');
        work.chunksChecked += items.length;
      }
      work.modesChecked++;
    }
    return work.filesChecked ? { eligible: true, reason: 'complete-verified-cache-coverage', work } : refuse('no-cache-inputs');
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) { throwIfAborted(signal); throw error; }
    return refuse('cache-or-input-unavailable');
  }
};

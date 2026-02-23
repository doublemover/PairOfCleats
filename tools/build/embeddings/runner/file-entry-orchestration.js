import path from 'node:path';
import { fromPosix, toPosix } from '../../../../src/shared/files.js';

/**
 * Resolve candidate absolute paths for one logical embedding file.
 *
 * Records mode keeps historical fallback behavior:
 * 1. `triage/records/*` first checks the explicit records directory.
 * 2. Non-triage records first check the repo root.
 * 3. Missing records paths can fall through to the alternate location.
 *
 * @param {{
 *   mode:string,
 *   root:string,
 *   recordsDir:string|null|undefined,
 *   normalizedRel:string
 * }} input
 * @returns {string[]}
 */
export const resolveFileReadCandidates = ({ mode, root, recordsDir, normalizedRel }) => {
  if (mode !== 'records') {
    return [path.resolve(root, fromPosix(normalizedRel))];
  }
  const resolvedRecordsDir = typeof recordsDir === 'string' && recordsDir
    ? recordsDir
    : root;
  if (normalizedRel.startsWith('triage/records/')) {
    const stripped = normalizedRel.slice('triage/records/'.length);
    return [
      path.resolve(resolvedRecordsDir, fromPosix(stripped)),
      path.resolve(root, fromPosix(normalizedRel))
    ];
  }
  return [
    path.resolve(root, fromPosix(normalizedRel)),
    path.resolve(resolvedRecordsDir, fromPosix(normalizedRel))
  ];
};

/**
 * Read file text/hash across ordered path candidates with records ENOENT
 * fallback semantics.
 *
 * @param {{
 *   mode:string,
 *   candidates:string[],
 *   scheduleIo:(worker:()=>Promise<any>)=>Promise<any>,
 *   readTextFileWithHashImpl:(filePath:string)=>Promise<{text:string,hash:string}>
 * }} input
 * @returns {Promise<{text:string,hash:string}>}
 */
export const readFileTextWithFallback = async ({
  mode,
  candidates,
  scheduleIo,
  readTextFileWithHashImpl
}) => {
  let lastErr = null;
  for (const candidate of candidates) {
    try {
      return await scheduleIo(() => readTextFileWithHashImpl(candidate));
    } catch (err) {
      lastErr = err;
      if (mode === 'records' && err?.code === 'ENOENT') {
        continue;
      }
      break;
    }
  }
  throw lastErr || new Error('Unknown read error');
};

/**
 * Create hot-path file entry processor for stage3 embeddings.
 *
 * Sequencing contract:
 * 1. Attempt cache reuse with manifest hash first (when available).
 * 2. Read file text/hash only if needed.
 * 3. Retry cache reuse with computed content hash before scheduling compute.
 *
 * Cache behavior note: when manifest hash is missing we intentionally skip the
 * initial lookup, because hashless lookups are guaranteed misses and add
 * avoidable hot-path overhead on repositories with sparse manifests.
 *
 * @param {{
 *   mode:string,
 *   root:string,
 *   recordsDir:string|null|undefined,
 *   manifestFiles:Record<string, any>,
 *   cacheState:object,
 *   cacheRepoId:string|null,
 *   cacheIdentityKey:string,
 *   cacheKeyFlags:string[],
 *   configuredDims:number|null,
 *   cacheCounters:object,
 *   scheduleIo:(worker:()=>Promise<any>)=>Promise<any>,
 *   assertDims:(dims:number)=>void,
 *   codeVectors:any[],
 *   docVectors:any[],
 *   mergedVectors:any[],
 *   addHnswFromQuantized:((target:'merged'|'doc'|'code',chunkIndex:number,vector:any)=>void)|null|undefined,
 *   markFileProcessed:(input:{chunkCount?:number,source?:string,skipped?:boolean})=>Promise<void>,
 *   computeFileEmbeddings:(input:object)=>Promise<void>,
 *   prepareFileEmbeddingWorkset:(input:object)=>Promise<object>,
 *   warn:(line:string)=>void,
 *   buildChunkSignatureImpl:(items:object[])=>string,
 *   buildCacheKeyImpl:(input:object)=>string|null,
 *   lookupCacheEntryWithStatsImpl:(input:object)=>Promise<object|null>,
 *   tryApplyCachedVectorsImpl:(input:object)=>boolean,
 *   readTextFileWithHashImpl:(filePath:string)=>Promise<{text:string,hash:string}>
 * }} input
 * @returns {(input:[string, object[]])=>Promise<void>}
 */
export const createFileEntryProcessor = ({
  mode,
  root,
  recordsDir,
  manifestFiles,
  cacheState,
  cacheRepoId,
  cacheIdentityKey,
  cacheKeyFlags,
  configuredDims,
  cacheCounters,
  scheduleIo,
  assertDims,
  codeVectors,
  docVectors,
  mergedVectors,
  addHnswFromQuantized,
  markFileProcessed,
  computeFileEmbeddings,
  prepareFileEmbeddingWorkset,
  warn,
  buildChunkSignatureImpl,
  buildCacheKeyImpl,
  lookupCacheEntryWithStatsImpl,
  tryApplyCachedVectorsImpl,
  readTextFileWithHashImpl
}) => async ([relPath, items]) => {
  const normalizedRel = toPosix(relPath);
  const chunkSignature = buildChunkSignatureImpl(items);
  const manifestEntry = manifestFiles[normalizedRel] || null;
  const manifestHash = typeof manifestEntry?.hash === 'string' ? manifestEntry.hash : null;
  let fileHash = manifestHash;
  const resolveCacheKey = (hash) => buildCacheKeyImpl({
    file: normalizedRel,
    hash,
    signature: chunkSignature,
    identityKey: cacheIdentityKey,
    repoId: cacheRepoId,
    mode,
    featureFlags: cacheKeyFlags,
    pathPolicy: 'posix'
  });
  let cacheKey = fileHash ? resolveCacheKey(fileHash) : null;
  const tryServeFromCache = async ({ cacheKeyForFile, fileHashForFile }) => {
    const cached = await lookupCacheEntryWithStatsImpl({
      cacheState,
      cacheKey: cacheKeyForFile,
      fileHash: fileHashForFile,
      chunkSignature,
      cacheIdentityKey,
      scheduleIo,
      counters: cacheCounters
    });
    const reused = tryApplyCachedVectorsImpl({
      cached,
      items,
      normalizedRel,
      mode,
      configuredDims,
      cacheIdentityKey,
      chunkSignature,
      fileHash: fileHashForFile,
      cacheKey: cacheKeyForFile,
      cacheState,
      counters: cacheCounters,
      assertDims,
      codeVectors,
      docVectors,
      mergedVectors,
      addHnswFromQuantized
    });
    if (!reused) return false;
    await markFileProcessed({
      chunkCount: items.length,
      source: 'cache'
    });
    return true;
  };
  if (fileHash && await tryServeFromCache({ cacheKeyForFile: cacheKey, fileHashForFile: fileHash })) {
    return;
  }

  let textInfo = null;
  try {
    const candidates = resolveFileReadCandidates({
      mode,
      root,
      recordsDir,
      normalizedRel
    });
    textInfo = await readFileTextWithFallback({
      mode,
      candidates,
      scheduleIo,
      readTextFileWithHashImpl
    });
  } catch (err) {
    const reason = err?.code ? `${err.code}: ${err.message || err}` : (err?.message || err);
    warn(`[embeddings] ${mode}: Failed to read ${normalizedRel}; skipping (${reason}).`);
    await markFileProcessed({
      chunkCount: items.length,
      source: 'skipped',
      skipped: true
    });
    return;
  }

  const text = textInfo.text;
  if (!fileHash) {
    fileHash = textInfo.hash;
    cacheKey = resolveCacheKey(fileHash);
    if (await tryServeFromCache({ cacheKeyForFile: cacheKey, fileHashForFile: fileHash })) {
      return;
    }
  }

  const {
    codeTexts,
    docTexts,
    codeMapping,
    docMapping,
    chunkHashes,
    chunkHashesFingerprint,
    reuse
  } = await prepareFileEmbeddingWorkset({
    text,
    items,
    cacheState,
    cacheKey,
    normalizedRel,
    scheduleIo
  });
  await computeFileEmbeddings({
    normalizedRel,
    items,
    cacheKey,
    fileHash,
    chunkSignature,
    chunkHashes,
    chunkHashesFingerprint,
    codeTexts,
    docTexts,
    codeMapping,
    docMapping,
    reuse
  });
};

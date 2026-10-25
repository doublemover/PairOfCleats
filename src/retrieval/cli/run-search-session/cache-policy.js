import { buildQueryCacheKey, getIndexSignature } from '../../cli-index.js';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';
import {
  findQueryCacheEntry,
  loadQueryCache,
  rememberQueryCacheEntry
} from '../../query-cache.js';
import { resolveRetrievalCachePath } from '../cache-paths.js';
import { persistQueryCacheTouch } from '../../query-cache-touches.js';
import { upsertQueryCacheEntry } from '../../query-cache-state.js';
import { throwIfAborted, isAbortError } from '../../../shared/abort.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { QUERY_PARSER_VERSION } from '../../query-plan-schema.js';
import { areRetrievalExecutionsReusable } from '../../../contracts/retrieval-execution.js';

const normalizePositiveIntOrNull = (value) => (
  Number.isFinite(Number(value)) ? Math.max(1, Math.floor(Number(value))) : null
);

const extractEmbeddingInputFormatting = (idx) => {
  const formatting = idx?.state?.embeddings?.embeddingIdentity?.inputFormatting;
  return formatting && typeof formatting === 'object' ? formatting : null;
};

export function resolveQueryCachePolicy({
  queryCacheStrategy,
  preferMemoryBackendOnCacheHit,
  queryCachePrewarm,
  queryCachePrewarmMaxEntries,
  queryCacheMemoryFreshMs,
  sqliteFtsOverfetch
}) {
  const cacheStrategy = queryCacheStrategy === 'memory-first' || preferMemoryBackendOnCacheHit === true
    ? 'memory-first'
    : 'disk-first';
  const cachePrewarmEnabled = queryCachePrewarm === true || cacheStrategy === 'memory-first';
  const cachePrewarmLimit = Number.isFinite(Number(queryCachePrewarmMaxEntries))
    ? Math.max(1, Math.floor(Number(queryCachePrewarmMaxEntries)))
    : 128;
  const cacheMemoryFreshMs = Number.isFinite(Number(queryCacheMemoryFreshMs))
    ? Math.max(0, Math.floor(Number(queryCacheMemoryFreshMs)))
    : 0;
  const sqliteFtsOverfetchCacheKey = {
    rowCap: normalizePositiveIntOrNull(sqliteFtsOverfetch?.rowCap),
    timeBudgetMs: normalizePositiveIntOrNull(sqliteFtsOverfetch?.timeBudgetMs),
    chunkSize: normalizePositiveIntOrNull(sqliteFtsOverfetch?.chunkSize)
  };

  return {
    cacheStrategy,
    cachePrewarmEnabled,
    cachePrewarmLimit,
    cacheMemoryFreshMs,
    sqliteFtsOverfetchCacheKey
  };
}

export function resolveEmbeddingInputFormattingByMode({
  idxCode,
  idxProse,
  idxExtractedProse,
  idxRecords
}) {
  return {
    code: extractEmbeddingInputFormatting(idxCode),
    prose: extractEmbeddingInputFormatting(idxProse),
    extractedProse: extractEmbeddingInputFormatting(idxExtractedProse),
    records: extractEmbeddingInputFormatting(idxRecords)
  };
}

export async function resolveQueryCacheLookup({
  queryCacheEnabled,
  queryCacheDir,
  metricsDir,
  useSqlite,
  backendLabel,
  sqliteCodePath,
  sqliteProsePath,
  sqliteExtractedProsePath,
  runCode,
  runProse,
  runRecords,
  runExtractedProse,
  extractedProseLoaded,
  commentsEnabled,
  rootDir,
  userConfig,
  indexDirByMode = null,
  indexBaseRootByMode = null,
  explicitRef = false,
  indexSignaturePayload = null,
  chunkAuthorEvidence = null,
  asOfContext = null,
  query,
  searchMode,
  topN,
  sqliteFtsRequested,
  annActive,
  annBackend,
  vectorExtension,
  vectorAnnEnabled,
  annAdaptiveProviders,
  relationBoost,
  annCandidateCap,
  annDiscovery,
  annCandidateMinDocCount,
  annCandidateMaxDocCount,
  bm25K1,
  bm25B,
  scoreBlend,
  rrf,
  fieldWeights,
  symbolBoost,
  resolvedDenseVectorMode,
  intentInfo,
  minhashMaxDocs,
  maxCandidates,
  sparseBackend,
  explain,
  sqliteFtsNormalize,
  sqliteFtsProfile,
  sqliteFtsWeights,
  sqliteFtsTrigram,
  sqliteFtsStemming,
  sqliteTailLatencyTuning,
  sqliteFtsOverfetchCacheKey,
  modelIds,
  embeddingProvider,
  embeddingOnnx,
  embeddingInputFormattingByMode,
  contextExpansionEnabled,
  contextExpansionOptions,
  contextExpansionRespectFilters,
  cacheFilters,
  graphRankingConfig,
  queryCacheTtlMs,
  queryCacheMaxEntries,
  cacheStrategy,
  cachePrewarmEnabled,
  cachePrewarmLimit,
  cacheMemoryFreshMs,
  signal = null
}) {
  throwIfAborted(signal);
  let cacheHit = false;
  let cacheKey = null;
  let cacheSignature = null;
  let cacheData = null;
  let cachedPayload = null;
  let cacheShouldPersist = false;
  let cacheHotPathHit = false;

  const queryCachePath = resolveRetrievalCachePath({
    queryCacheDir,
    metricsDir,
    fileName: 'queryCache.json'
  });
  if (!queryCacheEnabled) {
    return {
      queryCachePath,
      cacheHit,
      cacheKey,
      cacheSignature,
      cacheData,
      cachedPayload,
      cacheShouldPersist,
      cacheHotPathHit
    };
  }

  const signature = indexSignaturePayload && typeof indexSignaturePayload === 'object'
    ? indexSignaturePayload
    : await getIndexSignature({
      useSqlite,
      backendLabel,
      sqliteCodePath,
      sqliteProsePath,
      sqliteExtractedProsePath,
      runRecords,
      runExtractedProse,
      includeExtractedProse: extractedProseLoaded || commentsEnabled,
      root: rootDir,
      userConfig,
      indexDirByMode,
      indexBaseRootByMode,
      explicitRef,
      asOfContext
    });
  cacheSignature = stableStringifyForSignature({index:signature,queryParserVersion:QUERY_PARSER_VERSION,metadataPredicateVersion:2,
    ...(chunkAuthorEvidence ? { chunkAuthorEvidence } : {})});
  const cacheKeyInfo = buildQueryCacheKey({
    query,
    backend: backendLabel,
    mode: searchMode,
    topN,
    sqliteFtsRequested: sqliteFtsRequested === true,
    ann: annActive,
    annBackend,
    annMode: vectorExtension.annMode,
    annProvider: vectorExtension.provider,
    annExtension: vectorAnnEnabled,
    annAdaptiveProviders,
    relationBoost,
    annCandidatePolicy: {
      discovery: annDiscovery || 'independent',
      cap: annCandidateCap,
      minDocCount: annCandidateMinDocCount,
      maxDocCount: annCandidateMaxDocCount
    },
    bm25: {
      k1: bm25K1,
      b: bm25B
    },
    scoreBlend,
    rrf,
    fieldWeights,
    symbolBoost,
    denseVectorMode: resolvedDenseVectorMode,
    intent: intentInfo?.type || null,
    minhashMaxDocs,
    maxCandidates,
    sparseBackend,
    explain,
    sqliteFtsNormalize,
    sqliteFtsProfile,
    sqliteFtsWeights,
    sqliteFtsVariant: {
      trigram: sqliteFtsTrigram === true,
      stemming: sqliteFtsStemming === true
    },
    sqliteFtsTuning: {
      tailLatencyTuning: sqliteTailLatencyTuning === true,
      overfetch: sqliteFtsOverfetchCacheKey
    },
    comments: { enabled: commentsEnabled },
    models: modelIds,
    embeddings: {
      provider: embeddingProvider,
      onnxModel: embeddingOnnx.modelPath || null,
      onnxTokenizer: embeddingOnnx.tokenizerId || null,
      inputFormattingByMode: embeddingInputFormattingByMode
    },
    contextExpansion: {
      enabled: contextExpansionEnabled,
      maxPerHit: contextExpansionOptions.maxPerHit || null,
      maxTotal: contextExpansionOptions.maxTotal || null,
      includeCalls: contextExpansionOptions.includeCalls !== false,
      includeImports: contextExpansionOptions.includeImports !== false,
      includeExports: contextExpansionOptions.includeExports === true,
      includeUsages: contextExpansionOptions.includeUsages === true,
      respectFilters: contextExpansionRespectFilters
    },
    graphRanking: graphRankingConfig || null,
    filters: cacheFilters,
    asOf: asOfContext
      ? {
        ref: asOfContext.ref || null,
        identityHash: asOfContext.identityHash || null
      }
      : null
  });
  cacheKey = cacheKeyInfo.key;

  // Zero disables the canonical-validation grace period. The low-level hot
  // cache also supports unbounded in-memory consumers, so enforce this session
  // policy at both lookup sites rather than interpreting zero as infinite.
  const lookupStrategy = cacheStrategy === 'memory-first' && cacheMemoryFreshMs > 0
    ? 'memory-first' : 'disk-first';
  let entry = null;
  if (lookupStrategy === 'memory-first') {
    entry = findQueryCacheEntry(null, cacheKey, cacheSignature, {
      cachePath: queryCachePath,
      strategy: lookupStrategy,
      memoryFreshMs: cacheMemoryFreshMs,
      maxHotEntries: queryCacheMaxEntries
    });
    if (entry) cacheHotPathHit = true;
  }
  if (!entry) {
    cacheData = queryCachePath
      ? loadQueryCache(queryCachePath, {
        prewarm: cachePrewarmEnabled,
        maxHotEntries: queryCacheMaxEntries,
        prewarmMaxEntries: cachePrewarmLimit
      })
      : null;
    entry = findQueryCacheEntry(cacheData, cacheKey, cacheSignature, {
      cachePath: queryCachePath,
      strategy: lookupStrategy,
      memoryFreshMs: cacheMemoryFreshMs,
      maxHotEntries: queryCacheMaxEntries
    });
  }
  if (!entry) {
    return {
      queryCachePath,
      cacheHit,
      cacheKey,
      cacheSignature,
      cacheData,
      cachedPayload,
      cacheShouldPersist,
      cacheHotPathHit
    };
  }

  const requiredModes = [[runCode, 'code'], [runProse, 'prose'], [runExtractedProse, 'extracted-prose'], [runRecords, 'records']]
    .filter(([enabled]) => enabled).map(([, mode]) => mode);
  if (!areRetrievalExecutionsReusable(entry.meta?.executionOutcomes, requiredModes)) {
    return { queryCachePath, cacheHit: false, cacheKey, cacheSignature, cacheData,
      cachedPayload: null, cacheShouldPersist, cacheHotPathHit: false };
  }
  const timestamp = Number(entry.ts);
  const ttl = Number.isFinite(Number(entry.ttlMs)) ? Number(entry.ttlMs) : queryCacheTtlMs;
  if (!Number.isFinite(timestamp) || timestamp <= 0 || (ttl && (Date.now() - timestamp) > ttl)) {
    return {
      queryCachePath,
      cacheHit,
      cacheKey,
      cacheSignature,
      cacheData,
      cachedPayload,
      cacheShouldPersist,
      cacheHotPathHit
    };
  }

  cachedPayload = entry.payload || null;
  if (!cachedPayload) {
    return {
      queryCachePath,
      cacheHit,
      cacheKey,
      cacheSignature,
      cacheData,
      cachedPayload,
      cacheShouldPersist,
      cacheHotPathHit
    };
  }

  const hasCode = !runCode || Array.isArray(cachedPayload.code);
  const hasProse = !runProse || Array.isArray(cachedPayload.prose);
  const hasExtractedProse = !runExtractedProse || Array.isArray(cachedPayload.extractedProse);
  const hasRecords = !runRecords || Array.isArray(cachedPayload.records);
  if (!hasCode || !hasProse || !hasExtractedProse || !hasRecords) {
    return {
      queryCachePath,
      cacheHit,
      cacheKey,
      cacheSignature,
      cacheData,
      cachedPayload,
      cacheShouldPersist,
      cacheHotPathHit
    };
  }

  // Rendering/comment joins own mutable hit rows. Cache payloads retain their
  // immutable admitted data independently of those downstream enrichments.
  try {
    cachedPayload = structuredClone(cachedPayload);
    Object.defineProperty(cachedPayload, 'executionOutcomes', { value: structuredClone(entry.meta.executionOutcomes) });
  }
  catch (error) {
    observeStorageResource(error, { phase: 'query-cache-hit-admission' }).requireSettled();
    if (isAbortError(error)) throw error;
    return { queryCachePath, cacheHit: false, cacheKey, cacheSignature, cacheData,
      cachedPayload: null, cacheShouldPersist: false, cacheHotPathHit };
  }
  throwIfAborted(signal);
  cacheHit = true;
  entry = { ...entry, ts: Math.max(Number(entry.ts || 0), Date.now()) };
  let touchPersisted = false;
  if (entry.payloadId && queryCachePath) {
    try { touchPersisted = await persistQueryCacheTouch({ cachePath: queryCachePath, key: cacheKey,
      signature: cacheSignature, payloadId: entry.payloadId, ts: entry.ts, maxEntries: queryCacheMaxEntries }); }
    catch (error) {
      observeStorageResource(error, { phase: 'query-cache-touch' }).requireSettled();
      if (isAbortError(error)) throw error;
      touchPersisted = false;
    }
  }
  throwIfAborted(signal);
  if (touchPersisted) {
    rememberQueryCacheEntry(queryCachePath, cacheKey, cacheSignature, entry, queryCacheMaxEntries);
    return { queryCachePath, cacheHit, cacheKey, cacheSignature, cacheData,
      cachedPayload, cacheShouldPersist: false, cacheHotPathHit };
  }
  rememberQueryCacheEntry(queryCachePath, cacheKey, cacheSignature, entry, queryCacheMaxEntries);
  if (!cacheData) {
    cacheData = loadQueryCache(queryCachePath, { prewarm: false });
  }
  if (cacheData && Array.isArray(cacheData.entries)) {
    upsertQueryCacheEntry(cacheData, entry, { replacement: false });
    cacheShouldPersist = Boolean(queryCachePath);
  }

  return {
    queryCachePath,
    cacheHit,
    cacheKey,
    cacheSignature,
    cacheData,
    cachedPayload,
    cacheShouldPersist,
    cacheHotPathHit
  };
}

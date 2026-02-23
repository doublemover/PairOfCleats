import { buildQueryCacheKey, getIndexSignature } from '../../cli-index.js';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';
import {
  findQueryCacheEntry,
  loadQueryCache,
  rememberQueryCacheEntry
} from '../../query-cache.js';
import { resolveRetrievalCachePath } from '../cache-paths.js';

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
  cacheMemoryFreshMs
}) {
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

  const signature = await getIndexSignature({
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
  cacheSignature = stableStringifyForSignature(signature);
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

  let entry = null;
  if (cacheStrategy === 'memory-first') {
    entry = findQueryCacheEntry(null, cacheKey, cacheSignature, {
      cachePath: queryCachePath,
      strategy: cacheStrategy,
      memoryFreshMs: cacheMemoryFreshMs,
      maxHotEntries: queryCacheMaxEntries
    });
    if (entry) cacheHotPathHit = true;
  }
  if (!entry) {
    cacheData = queryCachePath
      ? loadQueryCache(queryCachePath, {
        prewarm: cachePrewarmEnabled,
        prewarmMaxEntries: cachePrewarmLimit
      })
      : null;
    entry = findQueryCacheEntry(cacheData, cacheKey, cacheSignature, {
      cachePath: queryCachePath,
      strategy: cacheStrategy,
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

  const ttl = Number.isFinite(Number(entry.ttlMs)) ? Number(entry.ttlMs) : queryCacheTtlMs;
  if (ttl && (Date.now() - entry.ts) > ttl) {
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

  cacheHit = true;
  entry.ts = Date.now();
  rememberQueryCacheEntry(queryCachePath, cacheKey, cacheSignature, entry, queryCacheMaxEntries);
  if (!cacheData) {
    cacheData = loadQueryCache(queryCachePath, { prewarm: false });
  }
  if (cacheData && Array.isArray(cacheData.entries)) {
    const existingIndex = cacheData.entries.findIndex((candidate) => (
      candidate?.key === cacheKey && candidate?.signature === cacheSignature
    ));
    if (existingIndex >= 0) {
      cacheData.entries[existingIndex] = {
        ...cacheData.entries[existingIndex],
        ts: entry.ts
      };
    } else {
      cacheData.entries.push(entry);
    }
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

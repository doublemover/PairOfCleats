import fs from 'node:fs/promises';
import path from 'node:path';
import { incCacheEvent } from '../../shared/metrics.js';
import { createSearchPipeline } from '../pipeline.js';
import { buildQueryCacheKey, getIndexSignature } from '../cli-index.js';
import { getQueryEmbedding } from '../embedding.js';
import { expandContext } from '../context-expansion.js';
import { loadQueryCache, pruneQueryCache } from '../query-cache.js';
import { filterChunks } from '../output.js';
import { runSearchByMode } from './search-runner.js';

export async function runSearchSession({
  rootDir,
  userConfig,
  metricsDir,
  query,
  searchMode,
  runCode,
  runProse,
  runExtractedProse,
  runRecords,
  topN,
  useSqlite,
  annEnabled,
  annActive,
  vectorExtension,
  vectorAnnEnabled,
  vectorAnnState,
  vectorAnnUsed,
  hnswConfig,
  hnswAnnState,
  hnswAnnUsed,
  sqliteFtsRequested,
  sqliteFtsNormalize,
  sqliteFtsProfile,
  sqliteFtsWeights,
  sqliteCodePath,
  sqliteProsePath,
  bm25K1,
  bm25B,
  fieldWeights,
  postingsConfig,
  queryTokens,
  phraseNgramSet,
  phraseRange,
  symbolBoost,
  filters,
  filtersActive,
  scoreBlend,
  rrf,
  minhashMaxDocs,
  buildCandidateSetSqlite,
  getTokenIndexForQuery,
  rankSqliteFts,
  rankVectorAnnSqlite,
  idxProse,
  idxExtractedProse,
  idxCode,
  idxRecords,
  modelConfig,
  modelIds,
  embeddingProvider,
  embeddingOnnx,
  embeddingQueryText,
  useStubEmbeddings,
  contextExpansionEnabled,
  contextExpansionOptions,
  contextExpansionRespectFilters,
  cacheFilters,
  queryCacheEnabled,
  queryCacheMaxEntries,
  queryCacheTtlMs,
  backendLabel,
  resolvedDenseVectorMode,
  intentInfo
}) {
  const searchPipeline = createSearchPipeline({
    useSqlite,
    sqliteFtsRequested,
    sqliteFtsNormalize,
    sqliteFtsProfile,
    sqliteFtsWeights,
    bm25K1,
    bm25B,
    fieldWeights,
    postingsConfig,
    queryTokens,
    phraseNgramSet,
    phraseRange,
    symbolBoost,
    filters,
    filtersActive,
    topN,
    annEnabled: annActive,
    scoreBlend,
    rrf,
    minhashMaxDocs,
    vectorAnnState,
    vectorAnnUsed,
    hnswAnnState,
    hnswAnnUsed,
    buildCandidateSetSqlite,
    getTokenIndexForQuery,
    rankSqliteFts,
    rankVectorAnnSqlite
  });

  let cacheHit = false;
  let cacheKey = null;
  let cacheSignature = null;
  let cacheData = null;
  let cachedPayload = null;

  const queryCachePath = path.join(metricsDir, 'queryCache.json');
  if (queryCacheEnabled) {
    const signature = getIndexSignature({
      useSqlite,
      backendLabel,
      sqliteCodePath,
      sqliteProsePath,
      runRecords,
      runExtractedProse,
      root: rootDir,
      userConfig
    });
    cacheSignature = JSON.stringify(signature);
    const cacheKeyInfo = buildQueryCacheKey({
      query,
      backend: backendLabel,
      mode: searchMode,
      topN,
      ann: annActive,
      annMode: vectorExtension.annMode,
      annProvider: vectorExtension.provider,
      annExtension: vectorAnnEnabled,
      scoreBlend,
      fieldWeights,
      denseVectorMode: resolvedDenseVectorMode,
      intent: intentInfo?.type || null,
      minhashMaxDocs,
      sqliteFtsNormalize,
      sqliteFtsProfile,
      sqliteFtsWeights,
      models: modelIds,
      embeddings: {
        provider: embeddingProvider,
        onnxModel: embeddingOnnx.modelPath || null,
        onnxTokenizer: embeddingOnnx.tokenizerId || null
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
      filters: cacheFilters
    });
    cacheKey = cacheKeyInfo.key;
    cacheData = loadQueryCache(queryCachePath);
    const entry = cacheData.entries.find((e) => e.key === cacheKey && e.signature === cacheSignature);
    if (entry) {
      const ttl = Number.isFinite(Number(entry.ttlMs)) ? Number(entry.ttlMs) : queryCacheTtlMs;
      if (!ttl || (Date.now() - entry.ts) <= ttl) {
        cachedPayload = entry.payload || null;
        if (cachedPayload) {
          const hasCode = !runCode || Array.isArray(cachedPayload.code);
          const hasProse = !runProse || Array.isArray(cachedPayload.prose);
          const hasRecords = !runRecords || Array.isArray(cachedPayload.records);
          if (hasCode && hasProse && hasRecords) {
            cacheHit = true;
            entry.ts = Date.now();
          }
        }
      }
    }
  }
  if (queryCacheEnabled) {
    incCacheEvent({ cache: 'query', result: cacheHit ? 'hit' : 'miss' });
  }

  const needsEmbedding = !cacheHit && annActive && (
    (runProse && (idxProse.denseVec?.vectors?.length || vectorAnnState.prose.available || hnswAnnState.prose.available))
    || (runCode && (idxCode.denseVec?.vectors?.length || vectorAnnState.code.available || hnswAnnState.code.available))
    || (runExtractedProse && idxExtractedProse?.denseVec?.vectors?.length)
    || (runRecords && idxRecords.denseVec?.vectors?.length)
  );
  const embeddingCache = new Map();
  const getEmbeddingForModel = async (modelId, dims) => {
    if (!modelId) return null;
    const cacheKeyLocal = useStubEmbeddings ? `${modelId}:${dims || 'default'}` : modelId;
    if (embeddingCache.has(cacheKeyLocal)) {
      incCacheEvent({ cache: 'embedding', result: 'hit' });
      return embeddingCache.get(cacheKeyLocal);
    }
    incCacheEvent({ cache: 'embedding', result: 'miss' });
    const embedding = await getQueryEmbedding({
      text: embeddingQueryText,
      modelId,
      dims,
      modelDir: modelConfig.dir,
      useStub: useStubEmbeddings,
      provider: embeddingProvider,
      onnxConfig: embeddingOnnx,
      rootDir
    });
    embeddingCache.set(cacheKeyLocal, embedding);
    return embedding;
  };
  const queryEmbeddingCode = needsEmbedding && runCode && (
    idxCode.denseVec?.vectors?.length
    || vectorAnnState.code.available
    || hnswAnnState.code.available
  )
    ? await getEmbeddingForModel(modelIds.code, idxCode.denseVec?.dims || null)
    : null;
  const queryEmbeddingProse = needsEmbedding && runProse && (
    idxProse.denseVec?.vectors?.length
    || vectorAnnState.prose.available
    || hnswAnnState.prose.available
  )
    ? await getEmbeddingForModel(modelIds.prose, idxProse.denseVec?.dims || null)
    : null;
  const queryEmbeddingExtractedProse = needsEmbedding && runExtractedProse && idxExtractedProse?.denseVec?.vectors?.length
    ? await getEmbeddingForModel(modelIds.extractedProse, idxExtractedProse.denseVec?.dims || null)
    : null;
  const queryEmbeddingRecords = needsEmbedding && runRecords && idxRecords.denseVec?.vectors?.length
    ? await getEmbeddingForModel(modelIds.records, idxRecords.denseVec?.dims || null)
    : null;

  const cachedHits = cacheHit && cachedPayload
    ? {
      proseHits: cachedPayload.prose || [],
      extractedProseHits: cachedPayload.extractedProse || [],
      codeHits: cachedPayload.code || [],
      recordHits: cachedPayload.records || []
    }
    : null;
  const { proseHits, extractedProseHits, codeHits, recordHits } = cachedHits || runSearchByMode({
    searchPipeline,
    runProse,
    runExtractedProse,
    runCode,
    runRecords,
    idxProse,
    idxExtractedProse,
    idxCode,
    idxRecords,
    queryEmbeddingProse,
    queryEmbeddingExtractedProse,
    queryEmbeddingCode,
    queryEmbeddingRecords
  });

  const contextExpansionStats = {
    enabled: contextExpansionEnabled,
    code: 0,
    prose: 0,
    'extracted-prose': 0,
    records: 0
  };
  const expandModeHits = (mode, idx, hits) => {
    if (!contextExpansionEnabled || !hits.length || !idx?.chunkMeta?.length) {
      return { hits, contextHits: [] };
    }
    const allowedIds = contextExpansionRespectFilters && filtersActive
      ? new Set(
        filterChunks(idx.chunkMeta, filters, idx.filterIndex, idx.fileRelations)
          .map((chunk) => chunk.id)
      )
      : null;
    const contextHits = expandContext({
      hits,
      chunkMeta: idx.chunkMeta,
      fileRelations: idx.fileRelations,
      repoMap: idx.repoMap,
      options: contextExpansionOptions,
      allowedIds
    });
    contextExpansionStats[mode] = contextHits.length;
    return { hits: hits.concat(contextHits), contextHits };
  };
  const proseExpanded = runProse ? expandModeHits('prose', idxProse, proseHits) : { hits: proseHits, contextHits: [] };
  const extractedProseExpanded = runExtractedProse
    ? expandModeHits('extracted-prose', idxExtractedProse, extractedProseHits)
    : { hits: extractedProseHits, contextHits: [] };
  const codeExpanded = runCode ? expandModeHits('code', idxCode, codeHits) : { hits: codeHits, contextHits: [] };
  const recordExpanded = runRecords ? expandModeHits('records', idxRecords, recordHits) : { hits: recordHits, contextHits: [] };

  const hnswActive = Object.values(hnswAnnUsed).some(Boolean);
  const annBackend = vectorAnnEnabled && (vectorAnnUsed.code || vectorAnnUsed.prose)
    ? 'sqlite-extension'
    : (hnswActive ? 'hnsw' : 'js');

  if (queryCacheEnabled && cacheKey) {
    if (!cacheData) cacheData = { version: 1, entries: [] };
    if (!cacheHit) {
      cacheData.entries = cacheData.entries.filter((entry) => entry.key !== cacheKey);
      cacheData.entries.push({
        key: cacheKey,
        ts: Date.now(),
        ttlMs: queryCacheTtlMs,
        signature: cacheSignature,
        meta: {
          query,
          backend: backendLabel
        },
        payload: {
          prose: proseHits,
          code: codeHits,
          records: recordHits
        }
      });
    }
    pruneQueryCache(cacheData, queryCacheMaxEntries);
    try {
      await fs.mkdir(path.dirname(queryCachePath), { recursive: true });
      await fs.writeFile(queryCachePath, JSON.stringify(cacheData, null, 2));
    } catch {}
  }

  return {
    proseHits,
    extractedProseHits,
    codeHits,
    recordHits,
    proseExpanded,
    extractedProseExpanded,
    codeExpanded,
    recordExpanded,
    contextExpansionStats,
    annBackend,
    cache: {
      enabled: queryCacheEnabled,
      hit: cacheHit,
      key: cacheKey
    }
  };
}

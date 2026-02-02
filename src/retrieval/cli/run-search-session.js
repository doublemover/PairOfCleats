import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { incCacheEvent } from '../../shared/metrics.js';
import { MAX_JSON_BYTES, readJsonFile } from '../../shared/artifact-io.js';
import { ERROR_CODES } from '../../shared/error-codes.js';
import { createSearchPipeline } from '../pipeline.js';
import { buildQueryCacheKey, getIndexSignature } from '../cli-index.js';
import { getQueryEmbedding } from '../embedding.js';
import { buildIndexSignature } from '../index-cache.js';
import {
  buildContextIndex,
  expandContext,
  serializeContextIndex,
  hydrateContextIndex
} from '../context-expansion.js';
import { loadQueryCache, pruneQueryCache } from '../query-cache.js';
import { filterChunks } from '../output.js';
import { runSearchByMode } from './search-runner.js';
import { resolveStubDims } from '../../shared/embedding.js';

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
  commentsEnabled,
  extractedProseLoaded,
  topN,
  useSqlite,
  annEnabled,
  annActive,
  annBackend,
  lancedbConfig,
  vectorExtension,
  vectorAnnEnabled,
  vectorAnnState,
  vectorAnnUsed,
  hnswConfig,
  hnswAnnState,
  hnswAnnUsed,
  lanceAnnState,
  lanceAnnUsed,
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
  queryAst,
  phraseNgramSet,
  phraseRange,
  symbolBoost,
  maxCandidates,
  filters,
  filtersActive,
  explain,
  scoreBlend,
  rrf,
  graphRankingConfig,
  minhashMaxDocs,
  sparseBackend,
  buildCandidateSetSqlite,
  getTokenIndexForQuery,
  rankSqliteFts,
  rankVectorAnnSqlite,
  sqliteHasFts,
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
  intentInfo,
  signal
}) {
  const resolvedDenseMode = typeof resolvedDenseVectorMode === 'string'
    ? resolvedDenseVectorMode.trim().toLowerCase()
    : 'merged';
  const sqliteVectorAllowed = resolvedDenseMode === 'merged';
  if (!sqliteVectorAllowed && vectorAnnEnabled && vectorAnnState) {
    const hasSqliteAnn = Object.values(vectorAnnState)
      .some((entry) => entry?.available === true);
    if (hasSqliteAnn) {
      console.warn(
        `[ann] sqlite-vec only supports merged vectors; disabling sqlite ANN for denseVectorMode=${resolvedDenseMode}.`
      );
    }
    for (const entry of Object.values(vectorAnnState)) {
      if (entry) entry.available = false;
    }
  }
  const throwIfAborted = () => {
    if (!signal?.aborted) return;
    const error = new Error('Search cancelled.');
    error.code = ERROR_CODES.CANCELLED;
    error.cancelled = true;
    throw error;
  };
  throwIfAborted();
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
    queryAst,
    phraseNgramSet,
    phraseRange,
    symbolBoost,
    maxCandidates,
    filters,
    filtersActive,
    explain,
    topN,
    annEnabled: annActive,
    annBackend,
    scoreBlend,
    rrf,
    graphRankingConfig,
    minhashMaxDocs,
    sparseBackend,
    vectorAnnState,
    vectorAnnUsed,
    hnswAnnState,
    hnswAnnUsed,
    lanceAnnState,
    lanceAnnUsed,
    lancedbConfig,
    buildCandidateSetSqlite,
    getTokenIndexForQuery,
    rankSqliteFts,
    rankVectorAnnSqlite,
    sqliteHasFts,
    signal
  });
  throwIfAborted();

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
      includeExtractedProse: extractedProseLoaded || commentsEnabled,
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
      annBackend,
      annMode: vectorExtension.annMode,
      annProvider: vectorExtension.provider,
      annExtension: vectorAnnEnabled,
      scoreBlend,
      fieldWeights,
      denseVectorMode: resolvedDenseVectorMode,
      intent: intentInfo?.type || null,
      minhashMaxDocs,
      maxCandidates,
      explain,
      sqliteFtsNormalize,
      sqliteFtsProfile,
      sqliteFtsWeights,
      comments: { enabled: commentsEnabled },
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
      graphRanking: graphRankingConfig || null,
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
          const hasExtractedProse = !runExtractedProse || Array.isArray(cachedPayload.extractedProse);
          const hasRecords = !runRecords || Array.isArray(cachedPayload.records);
          if (hasCode && hasProse && hasExtractedProse && hasRecords) {
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
  throwIfAborted();

  const hasAnn = (mode, idx) => Boolean(
    idx?.denseVec?.vectors?.length
    || vectorAnnState?.[mode]?.available
    || hnswAnnState?.[mode]?.available
    || lanceAnnState?.[mode]?.available
  );
  const resolveEmbeddingNormalize = (idx) => (
    idx?.state?.embeddings?.embeddingIdentity?.normalize !== false
  );
  const needsEmbedding = !cacheHit && annActive && (
    (runProse && hasAnn('prose', idxProse))
    || (runCode && hasAnn('code', idxCode))
    || (runExtractedProse && hasAnn('extracted-prose', idxExtractedProse))
    || (runRecords && hasAnn('records', idxRecords))
  );
  const resolveEmbeddingDims = (mode, idx) => (
    idx?.denseVec?.dims
    ?? idx?.hnsw?.meta?.dims
    ?? lanceAnnState?.[mode]?.dims
    ?? null
  );
  const embeddingCache = new Map();
  const getEmbeddingForModel = async (modelId, dims, normalize) => {
    throwIfAborted();
    if (!modelId) return null;
    const normalizeFlag = normalize !== false;
    const resolvedDims = useStubEmbeddings
      ? resolveStubDims(dims)
      : (Number.isFinite(Number(dims)) ? Math.floor(Number(dims)) : null);
    const cacheKeyLocal = useStubEmbeddings
      ? `${modelId}:${resolvedDims}:${normalizeFlag ? 'norm' : 'raw'}`
      : `${modelId}:${normalizeFlag ? 'norm' : 'raw'}`;
    if (embeddingCache.has(cacheKeyLocal)) {
      incCacheEvent({ cache: 'embedding', result: 'hit' });
      return embeddingCache.get(cacheKeyLocal);
    }
    incCacheEvent({ cache: 'embedding', result: 'miss' });
    const embedding = await getQueryEmbedding({
      text: embeddingQueryText,
      modelId,
      dims: resolvedDims,
      modelDir: modelConfig.dir,
      useStub: useStubEmbeddings,
      provider: embeddingProvider,
      onnxConfig: embeddingOnnx,
      rootDir,
      normalize: normalizeFlag
    });
    embeddingCache.set(cacheKeyLocal, embedding);
    return embedding;
  };
  const queryEmbeddingCode = needsEmbedding && runCode && hasAnn('code', idxCode)
    ? await getEmbeddingForModel(
      modelIds.code,
      resolveEmbeddingDims('code', idxCode),
      resolveEmbeddingNormalize(idxCode)
    )
    : null;
  const queryEmbeddingProse = needsEmbedding && runProse && hasAnn('prose', idxProse)
    ? await getEmbeddingForModel(
      modelIds.prose,
      resolveEmbeddingDims('prose', idxProse),
      resolveEmbeddingNormalize(idxProse)
    )
    : null;
  const queryEmbeddingExtractedProse = needsEmbedding && runExtractedProse && hasAnn('extracted-prose', idxExtractedProse)
    ? await getEmbeddingForModel(
      modelIds.extractedProse,
      resolveEmbeddingDims('extracted-prose', idxExtractedProse),
      resolveEmbeddingNormalize(idxExtractedProse)
    )
    : null;
  const queryEmbeddingRecords = needsEmbedding && runRecords && hasAnn('records', idxRecords)
    ? await getEmbeddingForModel(
      modelIds.records,
      resolveEmbeddingDims('records', idxRecords),
      resolveEmbeddingNormalize(idxRecords)
    )
    : null;
  throwIfAborted();

  const cachedHits = cacheHit && cachedPayload
    ? {
      proseHits: cachedPayload.prose || [],
      extractedProseHits: cachedPayload.extractedProse || [],
      codeHits: cachedPayload.code || [],
      recordHits: cachedPayload.records || []
    }
    : null;
  const { proseHits, extractedProseHits, codeHits, recordHits } = cachedHits || await runSearchByMode({
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
    queryEmbeddingRecords,
    signal
  });
  throwIfAborted();

  const joinComments = commentsEnabled && runCode && extractedProseLoaded;
  const commentLookup = (() => {
    if (!joinComments || !idxExtractedProse?.chunkMeta?.length) return null;
    const map = new Map();
    for (const chunk of idxExtractedProse.chunkMeta) {
      if (!chunk?.file) continue;
      const comments = chunk.docmeta?.comments;
      if (!Array.isArray(comments) || !comments.length) continue;
      for (const comment of comments) {
        if (!comment || !comment.text) continue;
        const start = Number(comment.start);
        const end = Number(comment.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        const key = `${chunk.file}:${start}:${end}`;
        const list = map.get(key) || [];
        list.push(comment);
        map.set(key, list);
      }
    }
    return map.size ? map : null;
  })();

  const attachCommentExcerpts = (hits) => {
    if (!commentLookup || !Array.isArray(hits) || !hits.length) return;
    for (const hit of hits) {
      if (!hit?.file) continue;
      const docmeta = hit.docmeta && typeof hit.docmeta === 'object' ? hit.docmeta : {};
      if (docmeta.commentExcerpts || docmeta.commentExcerpt) continue;
      const refs = docmeta.commentRefs;
      if (!Array.isArray(refs) || !refs.length) continue;
      const excerpts = [];
      for (const ref of refs) {
        const start = Number(ref?.start);
        const end = Number(ref?.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        const matches = commentLookup.get(`${hit.file}:${start}:${end}`);
        if (!matches?.length) continue;
        for (const match of matches) {
          if (!match?.text) continue;
          excerpts.push({
            type: ref?.type || match.type || null,
            style: ref?.style || match.style || null,
            languageId: ref?.languageId || match.languageId || null,
            start,
            end,
            startLine: ref?.startLine ?? match.startLine ?? null,
            endLine: ref?.endLine ?? match.endLine ?? null,
            text: match.text,
            truncated: match.truncated || false,
            indexed: match.indexed !== false
          });
        }
      }
      if (!excerpts.length) continue;
      const unique = [];
      const seen = new Set();
      for (const entry of excerpts) {
        const key = `${entry.start}:${entry.end}:${entry.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(entry);
      }
      if (!unique.length) continue;
      const limited = unique.slice(0, 3);
      hit.docmeta = {
        ...docmeta,
        commentExcerpts: limited,
        commentExcerpt: limited[0]?.text || null
      };
    }
  };

  attachCommentExcerpts(codeHits);

  const contextExpansionStats = {
    enabled: contextExpansionEnabled,
    code: { added: 0, workUnitsUsed: 0, truncation: null },
    prose: { added: 0, workUnitsUsed: 0, truncation: null },
    'extracted-prose': { added: 0, workUnitsUsed: 0, truncation: null },
    records: { added: 0, workUnitsUsed: 0, truncation: null }
  };
  const loadContextIndexCache = (idx) => {
    if (!idx?.indexDir) return null;
    const metaPath = path.join(idx.indexDir, 'context_index.meta.json');
    const dataPath = path.join(idx.indexDir, 'context_index.json');
    if (!fsSync.existsSync(metaPath) || !fsSync.existsSync(dataPath)) return null;
    let meta = null;
    try {
      meta = readJsonFile(metaPath, { maxBytes: MAX_JSON_BYTES });
    } catch {
      return null;
    }
    if (!meta?.signature || meta.version !== 1) return null;
    const signature = buildIndexSignature(idx.indexDir);
    if (signature !== meta.signature) return null;
    try {
      const raw = readJsonFile(dataPath, { maxBytes: MAX_JSON_BYTES });
      return hydrateContextIndex(raw);
    } catch {
      return null;
    }
  };
  const persistContextIndexCache = (idx, contextIndex) => {
    if (!idx?.indexDir || !contextIndex) return;
    const signature = buildIndexSignature(idx.indexDir);
    const payload = serializeContextIndex(contextIndex);
    if (!signature || !payload) return;
    const metaPath = path.join(idx.indexDir, 'context_index.meta.json');
    const dataPath = path.join(idx.indexDir, 'context_index.json');
    try {
      fsSync.writeFileSync(dataPath, `${JSON.stringify(payload)}\n`);
      fsSync.writeFileSync(metaPath, `${JSON.stringify({ version: 1, signature })}\n`);
    } catch {}
  };
  const getContextIndex = (idx) => {
    if (!idx?.chunkMeta?.length) return null;
    const cached = idx.contextIndex;
    if (cached && cached.chunkMeta === idx.chunkMeta && cached.repoMap === idx.repoMap) {
      return cached;
    }
    let next = loadContextIndexCache(idx);
    if (next) {
      next.chunkMeta = idx.chunkMeta;
      next.repoMap = idx.repoMap;
      idx.contextIndex = next;
      return next;
    }
    next = buildContextIndex({ chunkMeta: idx.chunkMeta, repoMap: idx.repoMap });
    idx.contextIndex = next;
    persistContextIndexCache(idx, next);
    return next;
  };
  const expandModeHits = (mode, idx, hits) => {
    if (!contextExpansionEnabled || !hits.length || !idx?.chunkMeta?.length) {
      return { hits, contextHits: [], stats: { added: 0, workUnitsUsed: 0, truncation: null } };
    }
    const allowedIds = contextExpansionRespectFilters && filtersActive
      ? new Set(
        filterChunks(idx.chunkMeta, filters, idx.filterIndex, idx.fileRelations)
          .map((chunk) => chunk.id)
      )
      : null;
    const result = expandContext({
      hits,
      chunkMeta: idx.chunkMeta,
      fileRelations: idx.fileRelations,
      repoMap: idx.repoMap,
      graphRelations: idx.graphRelations || null,
      options: {
        ...contextExpansionOptions,
        explain
      },
      allowedIds,
      contextIndex: getContextIndex(idx)
    });
    contextExpansionStats[mode] = result.stats;
    return {
      hits: hits.concat(result.contextHits),
      contextHits: result.contextHits,
      stats: result.stats
    };
  };
  const proseExpanded = runProse
    ? expandModeHits('prose', idxProse, proseHits)
    : { hits: proseHits, contextHits: [] };
  const extractedProseExpanded = runExtractedProse
    ? expandModeHits('extracted-prose', idxExtractedProse, extractedProseHits)
    : { hits: extractedProseHits, contextHits: [] };
  const codeExpanded = runCode
    ? expandModeHits('code', idxCode, codeHits)
    : { hits: codeHits, contextHits: [] };
  const recordExpanded = runRecords
    ? expandModeHits('records', idxRecords, recordHits)
    : { hits: recordHits, contextHits: [] };

  attachCommentExcerpts(codeExpanded.hits);
  throwIfAborted();

  const hnswActive = Object.values(hnswAnnUsed).some(Boolean);
  const lanceActive = Object.values(lanceAnnUsed).some(Boolean);
  const annBackendUsed = vectorAnnEnabled && (vectorAnnUsed.code || vectorAnnUsed.prose)
    ? 'sqlite-extension'
    : (lanceActive ? 'lancedb' : (hnswActive ? 'hnsw' : 'js'));

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
          extractedProse: extractedProseHits,
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
    annBackend: annBackendUsed,
    cache: {
      enabled: queryCacheEnabled,
      hit: cacheHit,
      key: cacheKey
    }
  };
}

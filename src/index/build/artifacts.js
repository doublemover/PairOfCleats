import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { log, logLine, showProgress } from '../../shared/progress.js';
import { MAX_JSON_BYTES, readJsonFile, loadJsonArrayArtifact } from '../../shared/artifact-io.js';
import { toPosix } from '../../shared/files.js';
import { writeJsonObjectFile } from '../../shared/json-stream.js';
import { runWithConcurrency } from '../../shared/concurrency.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { ensureDiskSpace } from '../../shared/disk-space.js';
import { estimateJsonBytes } from '../../shared/cache.js';
import { buildCacheKey } from '../../shared/cache-key.js';
import { sha1 } from '../../shared/hash.js';
import { stableStringifyForSignature } from '../../shared/stable-json.js';
import { resolveCompressionConfig } from './artifacts/compression.js';
import { getToolingConfig } from '../../shared/dict-utils.js';
import { writePiecesManifest } from './artifacts/checksums.js';
import { writeFileLists } from './artifacts/file-lists.js';
import { buildFileMeta, buildFileMetaColumnar, computeFileMetaFingerprint } from './artifacts/file-meta.js';
import { buildSerializedFilterIndex } from './artifacts/filter-index.js';
import { enqueueGraphRelationsArtifacts } from './artifacts/graph-relations.js';
import { writeIndexMetrics } from './artifacts/metrics.js';
import { enqueueRepoMapArtifacts, measureRepoMap } from './artifacts/repo-map.js';
import { hydrateFilterIndex } from '../../retrieval/filter-index.js';
import { SCHEDULER_QUEUE_NAMES } from './runtime/scheduler.js';
import {
  enqueueTokenPostingsArtifacts,
  resolveTokenPostingsPlan
} from './artifacts/token-postings.js';
import { resolveTokenMode } from './artifacts/token-mode.js';
import { createArtifactWriter } from './artifacts/writer.js';
import { formatBytes, summarizeFilterIndex } from './artifacts/helpers.js';
import { enqueueFileRelationsArtifacts } from './artifacts/writers/file-relations.js';
import { enqueueCallSitesArtifacts } from './artifacts/writers/call-sites.js';
import { enqueueRiskInterproceduralArtifacts } from './artifacts/writers/risk-interprocedural.js';
import { enqueueSymbolsArtifacts } from './artifacts/writers/symbols.js';
import { enqueueSymbolOccurrencesArtifacts } from './artifacts/writers/symbol-occurrences.js';
import { enqueueSymbolEdgesArtifacts } from './artifacts/writers/symbol-edges.js';
import { createRepoMapIterator } from './artifacts/writers/repo-map.js';
import {
  createChunkMetaIterator,
  enqueueChunkMetaArtifacts,
  resolveChunkMetaPlan,
  resolveChunkMetaOrder,
  resolveChunkMetaOrderById
} from './artifacts/writers/chunk-meta.js';
import { enqueueChunkUidMapArtifacts } from './artifacts/writers/chunk-uid-map.js';
import { enqueueVfsManifestArtifacts } from './artifacts/writers/vfs-manifest.js';
import { recordOrderingHash, updateBuildState } from './build-state.js';
import { applyByteBudget, resolveByteBudgetMap } from './byte-budget.js';
import { CHARGRAM_HASH_META } from '../../shared/chargram-hash.js';
import { createOrderingHasher } from '../../shared/order.js';

/**
 * Write index artifacts and metrics.
 * @param {object} input
 */
export async function writeIndexArtifacts(input) {
  const {
    scheduler = null,
    outDir,
    buildRoot,
    mode,
    state,
    postings,
    postingsConfig,
    modelId,
    useStubEmbeddings,
    dictSummary,
    timing,
    root,
    userConfig,
    incrementalEnabled,
    fileCounts,
    perfProfile,
    indexState,
    graphRelations,
    stageCheckpoints,
    riskInterproceduralEmitArtifacts = null,
    repoProvenance = null
  } = input;
  const orderingStage = indexState?.stage || 'stage2';
  const recordOrdering = async (artifact, ordering, rule) => {
    if (!buildRoot || !ordering?.orderingHash) return;
    await recordOrderingHash(buildRoot, {
      stage: orderingStage,
      mode,
      artifact,
      hash: ordering.orderingHash,
      rule,
      count: ordering.orderingCount
    });
  };
  const measureVocabOrdering = (vocab = []) => {
    if (!Array.isArray(vocab) || !vocab.length) {
      return { orderingHash: null, orderingCount: 0 };
    }
    const orderingHasher = createOrderingHasher();
    for (const entry of vocab) {
      orderingHasher.update(entry);
    }
    const result = orderingHasher.digest();
    return {
      orderingHash: result?.hash || null,
      orderingCount: result?.count || 0
    };
  };
  const indexingConfig = userConfig?.indexing || {};
  const documentExtractionEnabled = indexingConfig.documentExtraction?.enabled === true;
  const {
    resolvedTokenMode,
    tokenMaxFiles,
    tokenSampleSize
  } = resolveTokenMode({ indexingConfig, state, fileCounts });
  const {
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    compressionGzipOptions,
    compressibleArtifacts,
    compressionOverrides
  } = resolveCompressionConfig(indexingConfig);
  const resolveCompressionOverride = (base) => (
    compressionOverrides && Object.prototype.hasOwnProperty.call(compressionOverrides, base)
      ? compressionOverrides[base]
      : null
  );
  const resolveShardCompression = (base) => {
    const override = resolveCompressionOverride(base);
    if (override) {
      return override.enabled ? override.mode : null;
    }
    return compressionEnabled && !compressionKeepRaw && compressibleArtifacts.has(base)
      ? compressionMode
      : null;
  };
  const artifactConfig = indexingConfig.artifacts || {};
  const artifactMode = typeof artifactConfig.mode === 'string'
    ? artifactConfig.mode.toLowerCase()
    : 'auto';
  const fileMetaFormatConfig = typeof artifactConfig.fileMetaFormat === 'string'
    ? artifactConfig.fileMetaFormat.toLowerCase()
    : null;
  const chunkMetaFormatConfig = typeof artifactConfig.chunkMetaFormat === 'string'
    ? artifactConfig.chunkMetaFormat.toLowerCase()
    : null;
  const chunkMetaJsonlThreshold = Number.isFinite(Number(artifactConfig.chunkMetaJsonlThreshold))
    ? Math.max(0, Math.floor(Number(artifactConfig.chunkMetaJsonlThreshold)))
    : 200000;
  const chunkMetaShardSize = Number.isFinite(Number(artifactConfig.chunkMetaShardSize))
    ? Math.max(0, Math.floor(Number(artifactConfig.chunkMetaShardSize)))
    : 100000;
  const symbolArtifactsFormatConfig = typeof artifactConfig.symbolArtifactsFormat === 'string'
    ? artifactConfig.symbolArtifactsFormat.toLowerCase()
    : null;
  const tokenPostingsFormatConfig = typeof artifactConfig.tokenPostingsFormat === 'string'
    ? artifactConfig.tokenPostingsFormat.toLowerCase()
    : null;
  let tokenPostingsShardSize = Number.isFinite(Number(artifactConfig.tokenPostingsShardSize))
    ? Math.max(1000, Math.floor(Number(artifactConfig.tokenPostingsShardSize)))
    : 50000;
  const tokenPostingsShardThreshold = Number.isFinite(Number(artifactConfig.tokenPostingsShardThreshold))
    ? Math.max(0, Math.floor(Number(artifactConfig.tokenPostingsShardThreshold)))
    : 200000;

  const maxJsonBytes = MAX_JSON_BYTES;
  const byteBudgetState = resolveByteBudgetMap({ indexingConfig, maxJsonBytes });
  const byteBudgetPolicies = byteBudgetState.policies || {};
  const resolveBudget = (name) => byteBudgetPolicies?.[name] || null;
  const resolveBudgetMaxBytes = (name, fallback) => {
    const budget = resolveBudget(name);
    return Number.isFinite(budget?.maxBytes) ? budget.maxBytes : fallback;
  };
  const byteBudgetSnapshot = {
    generatedAt: new Date().toISOString(),
    maxJsonBytes,
    strict: !!byteBudgetState.strict,
    policies: byteBudgetPolicies
  };
  if (buildRoot) {
    await updateBuildState(buildRoot, { byteBudgets: byteBudgetSnapshot });
  }
  const maxJsonBytesSoft = maxJsonBytes * 0.9;
  const shardTargetBytes = maxJsonBytes * 0.75;
  const fileMetaBudget = resolveBudget('file_meta');
  const chunkMetaBudget = resolveBudget('chunk_meta');
  const tokenPostingsBudget = resolveBudget('token_postings');
  const repoMapBudget = resolveBudget('repo_map');
  const fileRelationsBudget = resolveBudget('file_relations');
  const vfsBudget = resolveBudget('vfs_manifest');
  const symbolEdgesBudget = resolveBudget('symbol_edges');
  const symbolOccurrencesBudget = resolveBudget('symbol_occurrences');
  const callSitesBudget = resolveBudget('call_sites');
  const chunkUidMapBudget = resolveBudget('chunk_uid_map');
  const graphRelationsBudget = resolveBudget('graph_relations');
  const fileMetaMaxBytes = resolveBudgetMaxBytes('file_meta', maxJsonBytes);
  const chunkMetaMaxBytes = resolveBudgetMaxBytes('chunk_meta', maxJsonBytes);
  const tokenPostingsMaxBytes = resolveBudgetMaxBytes('token_postings', maxJsonBytes);
  const repoMapMaxBytes = resolveBudgetMaxBytes('repo_map', maxJsonBytes);
  const fileRelationsMaxBytes = resolveBudgetMaxBytes('file_relations', maxJsonBytes);
  const vfsMaxBytes = resolveBudgetMaxBytes('vfs_manifest', maxJsonBytes);
  const symbolEdgesMaxBytes = resolveBudgetMaxBytes('symbol_edges', maxJsonBytes);
  const symbolOccurrencesMaxBytes = resolveBudgetMaxBytes('symbol_occurrences', maxJsonBytes);
  const callSitesMaxBytes = resolveBudgetMaxBytes('call_sites', maxJsonBytes);
  const chunkUidMapMaxBytes = resolveBudgetMaxBytes('chunk_uid_map', maxJsonBytes);
  const graphRelationsMaxBytes = resolveBudgetMaxBytes('graph_relations', maxJsonBytes);
  const tokenPostingsMaxBytesSoft = Number.isFinite(tokenPostingsMaxBytes) ? tokenPostingsMaxBytes * 0.9 : maxJsonBytesSoft;
  const tokenPostingsShardTargetBytes = Number.isFinite(tokenPostingsMaxBytes)
    ? tokenPostingsMaxBytes * 0.75
    : shardTargetBytes;
  const fileMetaColumnarThreshold = Number.isFinite(Number(artifactConfig.fileMetaColumnarThresholdBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fileMetaColumnarThresholdBytes)))
    : fileMetaMaxBytes;
  const toolingConfig = getToolingConfig(root, userConfig);
  const vfsHashRouting = toolingConfig?.vfs?.hashRouting === true;
  const resolveFileMetaFiles = () => {
    if (Array.isArray(state?.discoveredFiles) && state.discoveredFiles.length) {
      return state.discoveredFiles.slice();
    }
    if (state?.fileInfoByPath && typeof state.fileInfoByPath.keys === 'function') {
      return Array.from(state.fileInfoByPath.keys()).sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
    }
    return [];
  };
  const fileMetaFiles = resolveFileMetaFiles();
  let fileMetaFingerprint = fileMetaFiles.length
    ? computeFileMetaFingerprint({ files: fileMetaFiles, fileInfoByPath: state?.fileInfoByPath })
    : null;
  const fileMetaCacheFlags = [
    `format:${fileMetaFormatConfig || 'auto'}`,
    `columnarThreshold:${fileMetaColumnarThreshold}`
  ];
  const fileMetaCacheKey = fileMetaFingerprint
    ? buildCacheKey({
      repoHash: indexState?.repoId || null,
      buildConfigHash: fileMetaFingerprint,
      mode,
      schemaVersion: 'file-meta-cache-v1',
      featureFlags: fileMetaCacheFlags,
      pathPolicy: 'posix'
    }).key
    : null;
  let fileMeta = null;
  let fileIdByPath = new Map();
  let fileMetaFromCache = false;
  let fileMetaMeta = null;
  if (incrementalEnabled && fileMetaFingerprint) {
    const metaPath = path.join(outDir, 'file_meta.meta.json');
    try {
      if (fsSync.existsSync(metaPath)) {
        const metaRaw = readJsonFile(metaPath, { maxBytes: fileMetaMaxBytes });
        const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
        const cachedFingerprint = meta?.fingerprint ?? meta?.extensions?.fingerprint ?? null;
        const cachedCacheKey = meta?.cacheKey ?? meta?.extensions?.cacheKey ?? null;
        const cacheKeyMatches = !!(cachedCacheKey && fileMetaCacheKey && cachedCacheKey === fileMetaCacheKey);
        const fingerprintMatches = !!(cachedFingerprint && fileMetaFingerprint && cachedFingerprint === fileMetaFingerprint);
        if (cacheKeyMatches || (!cachedCacheKey && fingerprintMatches)) {
          fileMetaMeta = meta;
          const cached = await loadJsonArrayArtifact(outDir, 'file_meta', {
            maxBytes: fileMetaMaxBytes,
            strict: false
          });
          if (Array.isArray(cached)) {
            fileMeta = cached;
            fileMetaFromCache = true;
            for (const entry of cached) {
              if (entry?.file && Number.isFinite(entry.id)) {
                fileIdByPath.set(entry.file, entry.id);
              }
            }
          }
        }
      }
    } catch {}
  }
  if (!fileMeta) {
    const built = buildFileMeta(state);
    fileMeta = built.fileMeta;
    fileIdByPath = built.fileIdByPath;
    fileMetaFingerprint = built.fingerprint || fileMetaFingerprint;
  }
  if (indexState && typeof indexState === 'object') {
    if (!indexState.extensions || typeof indexState.extensions !== 'object') {
      indexState.extensions = {};
    }
    if (state?.discoveryHash) {
      indexState.extensions.discoveryHash = state.discoveryHash;
    }
    if (fileMetaFingerprint) {
      indexState.extensions.fileMetaFingerprint = fileMetaFingerprint;
    }
    if (postings?.minhashGuard) {
      indexState.extensions.minhashGuard = postings.minhashGuard;
    }
  }
  const chunkUidToFileId = new Map();
  if (state?.chunkUidToFile && typeof state.chunkUidToFile.entries === 'function') {
    for (const [chunkUid, file] of state.chunkUidToFile.entries()) {
      const fileId = fileIdByPath.get(file);
      if (!Number.isFinite(fileId)) continue;
      if (!chunkUidToFileId.has(chunkUid)) {
        chunkUidToFileId.set(chunkUid, fileId);
      }
    }
  } else {
    for (const chunk of state?.chunks || []) {
      const file = chunk?.file || chunk?.metaV2?.file || null;
      const chunkUid = chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;
      if (!file || !chunkUid) continue;
      const fileId = fileIdByPath.get(file);
      if (!Number.isFinite(fileId)) continue;
      if (!chunkUidToFileId.has(chunkUid)) {
        chunkUidToFileId.set(chunkUid, fileId);
      }
    }
  }
  const repoMapIterator = createRepoMapIterator({
    chunks: state.chunks,
    fileRelations: state.fileRelations
  });

  const { fileListPath } = await writeFileLists({
    outDir,
    state,
    userConfig,
    log
  });


  const resolvedConfig = normalizePostingsConfig(postingsConfig || {});
  const resolveExistingOrBakPath = (targetPath) => {
    if (!targetPath) return null;
    if (fsSync.existsSync(targetPath)) return targetPath;
    const bakPath = `${targetPath}.bak`;
    if (fsSync.existsSync(bakPath)) return bakPath;
    return null;
  };
  const previousPiecesManifestPath = path.join(outDir, 'pieces', 'manifest.json');
  let previousPiecesManifest = null;
  try {
    const source = resolveExistingOrBakPath(previousPiecesManifestPath);
    if (source) {
      previousPiecesManifest = readJsonFile(source, { maxBytes: maxJsonBytes });
    }
  } catch {}
  const previousPieces = Array.isArray(previousPiecesManifest?.pieces) ? previousPiecesManifest.pieces : [];
  const previousFilterIndexPiece = previousPieces.find((piece) => piece?.name === 'filter_index' && piece?.path);
  const previousFilterIndexPath = previousFilterIndexPiece?.path
    ? path.join(outDir, ...String(previousFilterIndexPiece.path).split('/'))
    : null;
  const previousFilterIndexSource = resolveExistingOrBakPath(previousFilterIndexPath);
  let filterIndex = null;
  let filterIndexStats = null;
  let filterIndexReused = false;
  const reusePreviousFilterIndex = (reason) => {
    if (!previousFilterIndexSource) return false;
    const note = reason ? ` (${reason})` : '';
    log(`[warn] [filter_index] build skipped; reusing previous artifact.${note}`);
    let previousRaw = null;
    try {
      previousRaw = readJsonFile(previousFilterIndexSource, { maxBytes: maxJsonBytes });
      validateSerializedFilterIndex(previousRaw);
    } catch (err) {
      const message = err?.message || String(err);
      log(`[warn] [filter_index] failed to reuse previous artifact; validation failed. (${message})`);
      return false;
    }
    filterIndexReused = true;
    addPieceFile({
      type: previousFilterIndexPiece?.type || 'chunks',
      name: 'filter_index',
      format: previousFilterIndexPiece?.format || 'json'
    }, previousFilterIndexSource);
    try {
      filterIndexStats = summarizeFilterIndex(previousRaw);
    } catch {
      filterIndexStats = { reused: true };
    }
    if (filterIndexStats && typeof filterIndexStats === 'object') {
      filterIndexStats.reused = true;
    }
    return true;
  };
  const validateSerializedFilterIndex = (candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('expected object');
    }
    if (!Number.isFinite(Number(candidate.schemaVersion))) {
      throw new Error('missing schemaVersion');
    }
    if (!Number.isFinite(Number(candidate.fileChargramN))) {
      throw new Error('missing fileChargramN');
    }
    if (!Array.isArray(candidate.fileById)) {
      throw new Error('missing fileById');
    }
    if (!Array.isArray(candidate.fileChunksById)) {
      throw new Error('missing fileChunksById');
    }
    if (candidate.byLang == null || typeof candidate.byLang !== 'object') {
      throw new Error('missing byLang');
    }
    const hydrated = hydrateFilterIndex(candidate);
    if (!hydrated) {
      throw new Error('hydrate failed');
    }
    return true;
  };
  try {
    filterIndex = buildSerializedFilterIndex({
      chunks: state.chunks,
      resolvedConfig,
      userConfig,
      root
    });
    validateSerializedFilterIndex(filterIndex);
    filterIndexStats = summarizeFilterIndex(filterIndex);
    if (filterIndexStats?.jsonBytes && filterIndexStats.jsonBytes > maxJsonBytesSoft) {
      log(
        `filter_index ~${formatBytes(filterIndexStats.jsonBytes)}; ` +
        'large filter indexes increase memory usage (consider sqlite for large repos).'
      );
    }
  } catch (err) {
    const message = err?.message || String(err);
    log(`[warn] [filter_index] build failed; skipping. (${message})`);
    filterIndex = null;
    filterIndexStats = null;
    reusePreviousFilterIndex(message);
  }
  const denseScale = 2 / 255;
  const chunkMetaHasIds = Array.isArray(state.chunks)
    && state.chunks.length > 0
    && state.chunks.every((chunk) => Number.isFinite(chunk?.id));
  const chunkMetaOrder = chunkMetaHasIds
    ? resolveChunkMetaOrderById(state.chunks)
    : resolveChunkMetaOrder(state.chunks);
  const chunkMetaIterator = createChunkMetaIterator({
    chunks: state.chunks,
    fileIdByPath,
    resolvedTokenMode,
    tokenSampleSize,
    maxJsonBytes: chunkMetaMaxBytes,
    order: chunkMetaOrder
  });
  const chunkMetaPlan = resolveChunkMetaPlan({
    chunks: state.chunks,
    chunkMetaIterator,
    artifactMode,
    chunkMetaFormatConfig,
    chunkMetaJsonlThreshold,
    chunkMetaShardSize,
    maxJsonBytes: chunkMetaMaxBytes
  });
  const {
    tokenPostingsFormat,
    tokenPostingsUseShards,
    tokenPostingsShardSize: resolvedTokenPostingsShardSize,
    tokenPostingsEstimate
  } = resolveTokenPostingsPlan({
    artifactMode,
    tokenPostingsFormatConfig,
    tokenPostingsShardSize,
    tokenPostingsShardThreshold,
    postings,
    maxJsonBytes: tokenPostingsMaxBytes,
    maxJsonBytesSoft: tokenPostingsMaxBytesSoft,
    shardTargetBytes: tokenPostingsShardTargetBytes,
    log
  });
  if (tokenPostingsEstimate?.estimatedBytes) {
    applyByteBudget({
      budget: tokenPostingsBudget,
      totalBytes: tokenPostingsEstimate.estimatedBytes,
      label: 'token_postings',
      stageCheckpoints,
      logger: log
    });
  }
  tokenPostingsShardSize = resolvedTokenPostingsShardSize;
  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes: tokenPostingsEstimate?.estimatedBytes,
    label: `${mode} token_postings`
  });
  const removeArtifact = async (targetPath) => {
    try {
      if (fsSync.existsSync(targetPath)) {
        logLine(`[artifact-cleanup] remove ${targetPath}`, { kind: 'status' });
      }
      await fs.rm(targetPath, { recursive: true, force: true });
    } catch {}
  };
  const removeCompressedArtifact = async (base) => {
    await removeArtifact(path.join(outDir, `${base}.json.gz`));
    await removeArtifact(path.join(outDir, `${base}.json.zst`));
  };
  const removePackedPostings = async () => {
    await removeArtifact(path.join(outDir, 'token_postings.packed.bin'));
    await removeArtifact(path.join(outDir, 'token_postings.packed.offsets.bin'));
    await removeArtifact(path.join(outDir, 'token_postings.packed.meta.json'));
  };
  const removePackedMinhash = async () => {
    await removeArtifact(path.join(outDir, 'minhash_signatures.packed.bin'));
    await removeArtifact(path.join(outDir, 'minhash_signatures.packed.meta.json'));
  };
  if (tokenPostingsFormat === 'packed') {
    await removeArtifact(path.join(outDir, 'token_postings.json'));
    await removeCompressedArtifact('token_postings');
    await removeArtifact(path.join(outDir, 'token_postings.meta.json'));
    await removeArtifact(path.join(outDir, 'token_postings.shards'));
  } else {
    await removePackedPostings();
  }
  if (tokenPostingsUseShards) {
    await removeArtifact(path.join(outDir, 'token_postings.json'));
    await removeCompressedArtifact('token_postings');
    await removeArtifact(path.join(outDir, 'token_postings.shards'));
  } else {
    await removeArtifact(path.join(outDir, 'token_postings.meta.json'));
    await removeArtifact(path.join(outDir, 'token_postings.shards'));
  }
  const writeStart = Date.now();
  const writes = [];
  let totalWrites = 0;
  let completedWrites = 0;
  let lastWriteLog = 0;
  let lastWriteLabel = '';
  const artifactMetrics = new Map();
  const writeLogIntervalMs = 1000;
  const writeProgressMeta = { stage: 'write', mode, taskId: `write:${mode}:artifacts` };
  const formatArtifactLabel = (filePath) => toPosix(path.relative(outDir, filePath));
  const pieceEntries = [];
  const addPieceFile = (entry, filePath) => {
    pieceEntries.push({ ...entry, path: formatArtifactLabel(filePath) });
  };
  addPieceFile({ type: 'stats', name: 'filelists', format: 'json' }, path.join(outDir, '.filelists.json'));
  const logWriteProgress = (label) => {
    completedWrites += 1;
    if (label) lastWriteLabel = label;
    showProgress('Artifacts', completedWrites, totalWrites, {
      ...writeProgressMeta,
      message: label || null
    });
    const now = Date.now();
    if (completedWrites === totalWrites || completedWrites === 1 || (now - lastWriteLog) >= writeLogIntervalMs) {
      lastWriteLog = now;
      const percent = totalWrites > 0
        ? (completedWrites / totalWrites * 100).toFixed(1)
        : '100.0';
      const suffix = lastWriteLabel ? ` | ${lastWriteLabel}` : '';
      logLine(`Writing index files ${completedWrites}/${totalWrites} (${percent}%)${suffix}`, { kind: 'status' });
    }
  };
  const recordArtifactMetric = (label, metric) => {
    if (!label) return;
    const existing = artifactMetrics.get(label) || { path: label };
    artifactMetrics.set(label, { ...existing, ...metric });
  };
  const enqueueWrite = (label, job) => {
    writes.push({
      label,
      job: async () => {
        const started = Date.now();
        await job();
        const durationMs = Date.now() - started;
        let bytes = null;
        if (label) {
          try {
            const stat = await fs.stat(path.join(outDir, label));
            bytes = stat.size;
          } catch {}
        }
        recordArtifactMetric(label, { durationMs, bytes });
      }
    });
  };
  if (indexState && typeof indexState === 'object') {
    const indexStatePath = path.join(outDir, 'index_state.json');
    const indexStateMetaPath = path.join(outDir, 'index_state.meta.json');
    const stableState = { ...indexState };
    if ('generatedAt' in stableState) delete stableState.generatedAt;
    if ('updatedAt' in stableState) delete stableState.updatedAt;
    const stableHash = sha1(stableStringifyForSignature(stableState));
    let canSkipIndexState = false;
    try {
      if (fsSync.existsSync(indexStateMetaPath) && fsSync.existsSync(indexStatePath)) {
        const metaRaw = readJsonFile(indexStateMetaPath, { maxBytes: maxJsonBytes });
        const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
        if (meta?.stableHash === stableHash) {
          canSkipIndexState = true;
        }
      }
    } catch {}
    const indexStateWarnBytes = Math.max(1024 * 64, Math.floor(maxJsonBytes * 0.1));
    const indexStateCompressThreshold = Math.max(1024 * 128, Math.floor(maxJsonBytes * 0.2));
    const writeIndexStateMeta = async (bytes) => {
      await writeJsonObjectFile(indexStateMetaPath, {
        fields: {
          stableHash,
          generatedAt: indexState.generatedAt || null,
          updatedAt: new Date().toISOString(),
          bytes: Number.isFinite(bytes) ? bytes : null
        },
        atomic: true
      });
    };
    if (!canSkipIndexState) {
      enqueueWrite(
        formatArtifactLabel(indexStatePath),
        async () => {
          await writeJsonObjectFile(indexStatePath, { fields: indexState, atomic: true });
          let bytes = null;
          try {
            const stat = await fs.stat(indexStatePath);
            bytes = stat.size;
          } catch {}
          if (Number.isFinite(bytes) && bytes > indexStateWarnBytes) {
            log(
              `index_state ~${formatBytes(bytes)}; consider pruning volatile fields or enabling compression.`
            );
          }
          if (compressionEnabled && compressionMode && Number.isFinite(bytes) && bytes > indexStateCompressThreshold) {
            const compressedPath = path.join(
              outDir,
              `index_state.${compressionMode === 'zstd' ? 'json.zst' : 'json.gz'}`
            );
            await writeJsonObjectFile(compressedPath, {
              fields: indexState,
              compression: compressionMode,
              gzipOptions: compressionGzipOptions,
              atomic: true
            });
          }
          await writeIndexStateMeta(bytes);
        }
      );
    } else {
      enqueueWrite(
        formatArtifactLabel(indexStateMetaPath),
        async () => {
          let bytes = null;
          try {
            const stat = await fs.stat(indexStatePath);
            bytes = stat.size;
          } catch {}
          await writeIndexStateMeta(bytes);
        }
      );
    }
    addPieceFile({ type: 'stats', name: 'index_state', format: 'json' }, indexStatePath);
  }
  const { enqueueJsonObject, enqueueJsonArray, enqueueJsonArraySharded } = createArtifactWriter({
    outDir,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    compressionGzipOptions,
    compressibleArtifacts,
    compressionOverrides
  });
  if (state.importResolutionGraph) {
    const importGraphDir = path.join(outDir, 'artifacts');
    const importGraphPath = path.join(importGraphDir, 'import_resolution_graph.json');
    enqueueWrite(
      formatArtifactLabel(importGraphPath),
      async () => {
        await fs.mkdir(importGraphDir, { recursive: true });
        await writeJsonObjectFile(importGraphPath, {
          fields: state.importResolutionGraph,
          atomic: true
        });
      }
    );
    addPieceFile(
      { type: 'debug', name: 'import_resolution_graph', format: 'json' },
      importGraphPath
    );
  }

  const denseVectorsEnabled = postings.dims > 0 && postings.quantizedVectors.length;
  if (!denseVectorsEnabled) {
    await removeArtifact(path.join(outDir, 'dense_vectors_uint8.json'));
    await removeCompressedArtifact('dense_vectors_uint8');
    await removeArtifact(path.join(outDir, 'dense_vectors_doc_uint8.json'));
    await removeCompressedArtifact('dense_vectors_doc_uint8');
    await removeArtifact(path.join(outDir, 'dense_vectors_code_uint8.json'));
    await removeCompressedArtifact('dense_vectors_code_uint8');
  }
  if (denseVectorsEnabled) {
    enqueueJsonObject('dense_vectors_uint8', {
      fields: { model: modelId, dims: postings.dims, scale: denseScale },
      arrays: { vectors: postings.quantizedVectors }
    }, {
      piece: {
        type: 'embeddings',
        name: 'dense_vectors',
        count: postings.quantizedVectors.length,
        dims: postings.dims
      }
    });
  }
  const fileMetaEstimatedBytes = estimateJsonBytes(fileMeta);
  const fileMetaFormat = fileMetaFormatConfig || 'auto';
  const fileMetaExceedsMax = Number.isFinite(fileMetaMaxBytes)
    ? fileMetaEstimatedBytes > fileMetaMaxBytes
    : false;
  const fileMetaUseColumnar = !fileMetaExceedsMax
    && (fileMetaFormat === 'columnar' || fileMetaFormat === 'auto')
    && fileMetaEstimatedBytes >= fileMetaColumnarThreshold;
  const fileMetaUseJsonl = fileMetaFormat === 'jsonl'
    || fileMetaExceedsMax
    || (!fileMetaUseColumnar && Number.isFinite(fileMetaMaxBytes)
      && fileMetaEstimatedBytes > fileMetaMaxBytes);
  applyByteBudget({
    budget: fileMetaBudget,
    totalBytes: fileMetaEstimatedBytes,
    label: 'file_meta',
    stageCheckpoints,
    logger: log
  });
  const fileMetaMetaPath = path.join(outDir, 'file_meta.meta.json');
  if (!fileMetaFromCache) {
    if (fileMetaUseColumnar) {
      const columnarPath = path.join(outDir, 'file_meta.columnar.json');
      enqueueWrite(
        formatArtifactLabel(columnarPath),
        async () => {
          await removeArtifact(path.join(outDir, 'file_meta.json'));
          await removeCompressedArtifact('file_meta');
          await removeArtifact(path.join(outDir, 'file_meta.parts'));
          const payload = buildFileMetaColumnar(fileMeta);
          await writeJsonObjectFile(columnarPath, { fields: payload, atomic: true });
          await writeJsonObjectFile(fileMetaMetaPath, {
            fields: {
              schemaVersion: '1.0.0',
              artifact: 'file_meta',
              format: 'columnar',
              generatedAt: new Date().toISOString(),
              compression: 'none',
              totalRecords: fileMeta.length,
              totalBytes: fileMetaEstimatedBytes,
              maxPartRecords: fileMeta.length,
              maxPartBytes: fileMetaEstimatedBytes,
              targetMaxBytes: null,
              parts: [{ path: 'file_meta.columnar.json', records: fileMeta.length, bytes: fileMetaEstimatedBytes }],
              cacheKey: fileMetaCacheKey || null,
              extensions: {
                fingerprint: fileMetaFingerprint || null,
                cacheKey: fileMetaCacheKey || null
              }
            },
            atomic: true
          });
        }
      );
      addPieceFile({ type: 'chunks', name: 'file_meta', format: 'columnar', count: fileMeta.length }, columnarPath);
      addPieceFile({ type: 'chunks', name: 'file_meta_meta', format: 'json' }, fileMetaMetaPath);
    } else if (fileMetaUseJsonl) {
      enqueueWrite(
        formatArtifactLabel(path.join(outDir, 'file_meta.parts')),
        async () => {
          await removeArtifact(path.join(outDir, 'file_meta.json'));
          await removeCompressedArtifact('file_meta');
        }
      );
      enqueueJsonArraySharded('file_meta', fileMeta, {
        maxBytes: fileMetaMaxBytes,
        piece: { type: 'chunks', name: 'file_meta' },
        metaExtensions: { fingerprint: fileMetaFingerprint || null, cacheKey: fileMetaCacheKey || null },
        compression: null,
        gzipOptions: null,
        offsets: true
      });
    } else {
      enqueueJsonArray('file_meta', fileMeta, {
        compressible: false,
        piece: { type: 'chunks', name: 'file_meta', count: fileMeta.length }
      });
      enqueueWrite(
        formatArtifactLabel(fileMetaMetaPath),
        async () => {
          await writeJsonObjectFile(fileMetaMetaPath, {
            fields: {
              schemaVersion: '1.0.0',
              artifact: 'file_meta',
              format: 'json',
              generatedAt: new Date().toISOString(),
              compression: 'none',
              totalRecords: fileMeta.length,
              totalBytes: fileMetaEstimatedBytes,
              maxPartRecords: fileMeta.length,
              maxPartBytes: fileMetaEstimatedBytes,
              targetMaxBytes: null,
              parts: [{ path: 'file_meta.json', records: fileMeta.length, bytes: fileMetaEstimatedBytes }],
              cacheKey: fileMetaCacheKey || null,
              extensions: {
                fingerprint: fileMetaFingerprint || null,
                cacheKey: fileMetaCacheKey || null
              }
            },
            atomic: true
          });
        }
      );
    }
  } else {
    const cachedFormat = typeof fileMetaMeta?.format === 'string' ? fileMetaMeta.format : 'json';
    if (cachedFormat === 'jsonl-sharded' && Array.isArray(fileMetaMeta?.parts)) {
      for (const part of fileMetaMeta.parts) {
        const relPath = typeof part === 'string' ? part : part?.path;
        if (!relPath) continue;
        const absPath = path.join(outDir, relPath);
        addPieceFile({
          type: 'chunks',
          name: 'file_meta',
          format: 'jsonl',
          count: typeof part === 'object' && Number.isFinite(part.records) ? part.records : null,
          compression: fileMetaMeta?.compression || null
        }, absPath);
      }
      addPieceFile({ type: 'chunks', name: 'file_meta_meta', format: 'json' }, fileMetaMetaPath);
    } else if (cachedFormat === 'columnar' && Array.isArray(fileMetaMeta?.parts)) {
      const part = fileMetaMeta.parts[0];
      const relPath = typeof part === 'string' ? part : part?.path;
      if (relPath) {
        const absPath = path.join(outDir, relPath);
        addPieceFile({
          type: 'chunks',
          name: 'file_meta',
          format: 'columnar',
          count: typeof part === 'object' && Number.isFinite(part.records) ? part.records : null
        }, absPath);
      }
      addPieceFile({ type: 'chunks', name: 'file_meta_meta', format: 'json' }, fileMetaMetaPath);
    } else {
      addPieceFile({ type: 'chunks', name: 'file_meta', format: 'json', count: fileMeta.length }, path.join(outDir, 'file_meta.json'));
      if (fsSync.existsSync(fileMetaMetaPath)) {
        addPieceFile({ type: 'chunks', name: 'file_meta_meta', format: 'json' }, fileMetaMetaPath);
      }
    }
  }
  if (denseVectorsEnabled) {
    enqueueJsonObject('dense_vectors_doc_uint8', {
      fields: { model: modelId, dims: postings.dims, scale: denseScale },
      arrays: { vectors: postings.quantizedDocVectors }
    }, {
      piece: {
        type: 'embeddings',
        name: 'dense_vectors_doc',
        count: postings.quantizedDocVectors.length,
        dims: postings.dims
      }
    });
    enqueueJsonObject('dense_vectors_code_uint8', {
      fields: { model: modelId, dims: postings.dims, scale: denseScale },
      arrays: { vectors: postings.quantizedCodeVectors }
    }, {
      piece: {
        type: 'embeddings',
        name: 'dense_vectors_code',
        count: postings.quantizedCodeVectors.length,
        dims: postings.dims
      }
    });
  }
  const chunkMetaCompression = resolveShardCompression('chunk_meta');
  const chunkMetaOrdering = await enqueueChunkMetaArtifacts({
    state,
    outDir,
    mode,
    chunkMetaIterator,
    chunkMetaPlan,
    maxJsonBytes: chunkMetaMaxBytes,
    byteBudget: chunkMetaBudget,
    compression: chunkMetaCompression,
    gzipOptions: chunkMetaCompression === 'gzip' ? compressionGzipOptions : null,
    enqueueJsonArray,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    stageCheckpoints
  });
  await recordOrdering('chunk_meta', chunkMetaOrdering, 'chunk_meta:compareChunkMetaRows');
  const chunkUidMapCompression = resolveShardCompression('chunk_uid_map');
  await enqueueChunkUidMapArtifacts({
    outDir,
    mode,
    chunks: state.chunks,
    maxJsonBytes: chunkUidMapMaxBytes,
    byteBudget: chunkUidMapBudget,
    compression: chunkUidMapCompression,
    gzipOptions: chunkUidMapCompression === 'gzip' ? compressionGzipOptions : null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    stageCheckpoints
  });
  const vfsManifestCompression = resolveShardCompression('vfs_manifest');
  await enqueueVfsManifestArtifacts({
    outDir,
    mode,
    rows: state.vfsManifestCollector || state.vfsManifestRows,
    maxJsonBytes: vfsMaxBytes,
    byteBudget: vfsBudget,
    compression: vfsManifestCompression,
    gzipOptions: vfsManifestCompression === 'gzip' ? compressionGzipOptions : null,
    hashRouting: vfsHashRouting,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    stageCheckpoints
  });
  const repoMapMeasurement = measureRepoMap({ repoMapIterator, maxJsonBytes: repoMapMaxBytes });
  const useRepoMapJsonl = repoMapMeasurement.totalEntries
    && repoMapMaxBytes
    && repoMapMeasurement.totalBytes > repoMapMaxBytes;
  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes: useRepoMapJsonl ? repoMapMeasurement.totalJsonlBytes : repoMapMeasurement.totalBytes,
    label: `${mode} repo_map`
  });
  const repoMapCompression = resolveShardCompression('repo_map');
  await enqueueRepoMapArtifacts({
    outDir,
    repoMapIterator,
    repoMapMeasurement,
    useRepoMapJsonl,
    maxJsonBytes: repoMapMaxBytes,
    byteBudget: repoMapBudget,
    repoMapCompression,
    compressionGzipOptions,
    log,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    removeArtifact,
    stageCheckpoints
  });
  await recordOrdering('repo_map', repoMapMeasurement, 'repo_map:file,name,kind,signature,startLine');
  if (filterIndex) {
    enqueueJsonObject('filter_index', { fields: filterIndex }, {
      compressible: false,
      piece: { type: 'chunks', name: 'filter_index' }
    });
  }
  const minhashFromPostings = Array.isArray(postings.minhashSigs) && postings.minhashSigs.length
    ? postings.minhashSigs
    : null;
  const minhashStream = postings.minhashStream && Array.isArray(state?.chunks) && state.chunks.length;
  const minhashCount = minhashFromPostings
    ? postings.minhashSigs.length
    : (minhashStream ? state.chunks.length : (postings.minhashSigs?.length || 0));
  const minhashIterable = minhashFromPostings
    ? minhashFromPostings
    : (minhashStream
      ? (function* () {
        for (const chunk of state.chunks) {
          yield chunk?.minhashSig;
        }
      })()
      : (postings.minhashSigs || []));
  enqueueJsonObject('minhash_signatures', { arrays: { signatures: minhashIterable } }, {
    piece: {
      type: 'postings',
      name: 'minhash_signatures',
      count: minhashCount
    }
  });
  const packMinhashSignatures = ({ signatures, chunks }) => {
    const source = Array.isArray(signatures) && signatures.length ? signatures : null;
    const sourceChunks = Array.isArray(chunks) && chunks.length ? chunks : null;
    if (!source && !sourceChunks) return null;
    const first = source ? source[0] : sourceChunks[0]?.minhashSig;
    if (!Array.isArray(first) || !first.length) return null;
    const dims = first.length;
    const count = source ? source.length : sourceChunks.length;
    const total = dims * count;
    const buffer = Buffer.allocUnsafe(total * 4);
    const view = new Uint32Array(buffer.buffer, buffer.byteOffset, total);
    let offset = 0;
    if (source) {
      for (const sig of source) {
        if (!Array.isArray(sig) || sig.length !== dims) return null;
        for (let i = 0; i < dims; i += 1) {
          const value = sig[i];
          view[offset] = Number.isFinite(value) ? value : 0;
          offset += 1;
        }
      }
    } else {
      for (const chunk of sourceChunks) {
        const sig = chunk?.minhashSig;
        if (!Array.isArray(sig) || sig.length !== dims) return null;
        for (let i = 0; i < dims; i += 1) {
          const value = sig[i];
          view[offset] = Number.isFinite(value) ? value : 0;
          offset += 1;
        }
      }
    }
    return { buffer, dims, count };
  };
  const packedMinhash = packMinhashSignatures({
    signatures: minhashFromPostings,
    chunks: minhashStream ? state.chunks : null
  });
  if (packedMinhash) {
    const packedPath = path.join(outDir, 'minhash_signatures.packed.bin');
    const packedMetaPath = path.join(outDir, 'minhash_signatures.packed.meta.json');
    enqueueWrite(
      formatArtifactLabel(packedPath),
      async () => {
        await fs.writeFile(packedPath, packedMinhash.buffer);
        await writeJsonObjectFile(packedMetaPath, {
          fields: {
            format: 'u32',
            endian: 'le',
            dims: packedMinhash.dims,
            count: packedMinhash.count
          },
          atomic: true
        });
      }
    );
    addPieceFile({
      type: 'postings',
      name: 'minhash_signatures_packed',
      format: 'bin',
      count: packedMinhash.count
    }, packedPath);
    addPieceFile({ type: 'postings', name: 'minhash_signatures_packed_meta', format: 'json' }, packedMetaPath);
  } else {
    await removePackedMinhash();
  }
  const tokenPostingsCompression = resolveShardCompression('token_postings');
  await enqueueTokenPostingsArtifacts({
    outDir,
    postings,
    state,
    tokenPostingsFormat,
    tokenPostingsUseShards,
    tokenPostingsShardSize,
    tokenPostingsCompression,
    enqueueJsonObject,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });
  const vocabOrder = {};
  const tokenOrdering = measureVocabOrdering(postings.tokenVocab);
  await recordOrdering('token_vocab', tokenOrdering, 'token_vocab:token');
  if (tokenOrdering.orderingHash) {
    vocabOrder.token = {
      hash: tokenOrdering.orderingHash,
      count: tokenOrdering.orderingCount
    };
  }
  if (postings.fieldPostings?.fields) {
    enqueueJsonObject('field_postings', { fields: { fields: postings.fieldPostings.fields } }, {
      piece: { type: 'postings', name: 'field_postings' }
    });
  }
  if (resolvedConfig.fielded !== false && Array.isArray(state.fieldTokens)) {
    enqueueJsonArray('field_tokens', state.fieldTokens, {
      piece: { type: 'postings', name: 'field_tokens', count: state.fieldTokens.length }
    });
  }
  const fileRelationsCompression = resolveShardCompression('file_relations');
  const fileRelationsOrdering = enqueueFileRelationsArtifacts({
    state,
    outDir,
    maxJsonBytes: fileRelationsMaxBytes,
    byteBudget: fileRelationsBudget,
    log,
    compression: fileRelationsCompression,
    gzipOptions: fileRelationsCompression === 'gzip' ? compressionGzipOptions : null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    stageCheckpoints
  });
  await recordOrdering('file_relations', fileRelationsOrdering, 'file_relations:file');
  const callSitesCompression = resolveShardCompression('call_sites');
  const riskStats = state?.riskInterproceduralStats || null;
  const riskConfig = riskStats?.effectiveConfig || null;
  const riskState = indexState?.riskInterprocedural || null;
  const emitArtifactsMode = riskInterproceduralEmitArtifacts
    || riskState?.emitArtifacts
    || riskConfig?.emitArtifacts
    || null;
  const allowCallSitesArtifacts = emitArtifactsMode !== 'none';
  const callSitesRequired = allowCallSitesArtifacts
    && riskState?.enabled === true
    && riskState?.summaryOnly !== true;
  const callSitesRef = allowCallSitesArtifacts
    ? enqueueCallSitesArtifacts({
      state,
      outDir,
      maxJsonBytes: callSitesMaxBytes,
      byteBudget: callSitesBudget,
      log,
      forceEmpty: callSitesRequired,
      compression: callSitesCompression,
      gzipOptions: callSitesCompression === 'gzip' ? compressionGzipOptions : null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      stageCheckpoints
    })
    : null;
  const riskSummariesCompression = resolveShardCompression('risk_summaries');
  const riskFlowsCompression = resolveShardCompression('risk_flows');
  if (mode === 'code' && state?.riskInterproceduralStats) {
    enqueueRiskInterproceduralArtifacts({
      state,
      outDir,
      maxJsonBytes,
      log,
      compression: riskSummariesCompression,
      flowsCompression: riskFlowsCompression,
      gzipOptions: compressionGzipOptions,
      emitArtifacts: riskInterproceduralEmitArtifacts || 'jsonl',
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      callSitesRef
    });
  }
  if (mode === 'code') {
    const symbolsCompression = resolveShardCompression('symbols');
    await enqueueSymbolsArtifacts({
      state,
      outDir,
      maxJsonBytes,
      log,
      compression: symbolsCompression,
      gzipOptions: symbolsCompression === 'gzip' ? compressionGzipOptions : null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel
    });
    const symbolOccurrencesCompression = resolveShardCompression('symbol_occurrences');
    await enqueueSymbolOccurrencesArtifacts({
      state,
      fileIdByPath,
      chunkUidToFileId,
      outDir,
      maxJsonBytes: symbolOccurrencesMaxBytes,
      byteBudget: symbolOccurrencesBudget,
      log,
      format: symbolArtifactsFormatConfig,
      compression: symbolOccurrencesCompression,
      gzipOptions: symbolOccurrencesCompression === 'gzip' ? compressionGzipOptions : null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      stageCheckpoints
    });
    const symbolEdgesCompression = resolveShardCompression('symbol_edges');
    await enqueueSymbolEdgesArtifacts({
      state,
      fileIdByPath,
      chunkUidToFileId,
      outDir,
      maxJsonBytes: symbolEdgesMaxBytes,
      byteBudget: symbolEdgesBudget,
      log,
      format: symbolArtifactsFormatConfig,
      compression: symbolEdgesCompression,
      gzipOptions: symbolEdgesCompression === 'gzip' ? compressionGzipOptions : null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      stageCheckpoints
    });
  }
  const scheduleRelations = scheduler?.schedule
    ? (fn) => scheduler.schedule(
      SCHEDULER_QUEUE_NAMES.stage2Relations,
      { cpu: 1, mem: 1 },
      fn
    )
    : (fn) => fn();
  const scheduleRelationsIo = scheduler?.schedule
    ? (fn) => scheduler.schedule(SCHEDULER_QUEUE_NAMES.stage2RelationsIo, { io: 1 }, fn)
    : (fn) => fn();
  const graphRelationsOrdering = await scheduleRelations(() => enqueueGraphRelationsArtifacts({
    graphRelations,
    chunks: state?.chunks || [],
    fileRelations: state?.fileRelations || null,
    caps: indexingConfig?.graph?.caps || null,
    outDir,
    maxJsonBytes: graphRelationsMaxBytes,
    byteBudget: graphRelationsBudget,
    log,
    scheduleIo: scheduleRelationsIo,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    removeArtifact
  }));
  await recordOrdering('graph_relations', graphRelationsOrdering, 'graph_relations:graph,node');
  if (resolvedConfig.enablePhraseNgrams !== false) {
    enqueueJsonObject('phrase_ngrams', {
      arrays: { vocab: postings.phraseVocab, postings: postings.phrasePostings }
    }, {
      piece: { type: 'postings', name: 'phrase_ngrams', count: postings.phraseVocab.length }
    });
    const phraseOrdering = measureVocabOrdering(postings.phraseVocab);
    await recordOrdering('phrase_ngrams', phraseOrdering, 'phrase_ngrams:ngram');
    if (phraseOrdering.orderingHash) {
      vocabOrder.phrase = {
        hash: phraseOrdering.orderingHash,
        count: phraseOrdering.orderingCount
      };
    }
  }
  if (resolvedConfig.enableChargrams !== false) {
    enqueueJsonObject('chargram_postings', {
      fields: { hash: CHARGRAM_HASH_META },
      arrays: { vocab: postings.chargramVocab, postings: postings.chargramPostings }
    }, {
      piece: { type: 'postings', name: 'chargram_postings', count: postings.chargramVocab.length }
    });
    const chargramOrdering = measureVocabOrdering(postings.chargramVocab);
    await recordOrdering('chargram_postings', chargramOrdering, 'chargram_postings:gram');
    if (chargramOrdering.orderingHash) {
      vocabOrder.chargram = {
        hash: chargramOrdering.orderingHash,
        count: chargramOrdering.orderingCount
      };
    }
  }
  if (Object.keys(vocabOrder).length) {
    enqueueJsonObject('vocab_order', {
      fields: {
        algo: 'sha1',
        generatedAt: new Date().toISOString(),
        vocab: vocabOrder
      }
    }, {
      piece: { type: 'postings', name: 'vocab_order' }
    });
  }
  totalWrites = writes.length;
  if (totalWrites) {
    const artifactLabel = totalWrites === 1 ? 'artifact' : 'artifacts';
    logLine(`Writing index files (${totalWrites} ${artifactLabel})...`, { kind: 'status' });
    const writeConcurrency = Math.max(1, Math.min(4, totalWrites));
    await runWithConcurrency(
      writes,
      writeConcurrency,
      async ({ label, job }) => {
        try {
          await job();
        } finally {
          logWriteProgress(label);
        }
      },
      { collectResults: false }
    );
    logLine('', { kind: 'status' });
  } else {
    logLine('Writing index files (0 artifacts)...', { kind: 'status' });
    logLine('', { kind: 'status' });
  }
  timing.writeMs = Date.now() - writeStart;
  timing.totalMs = Date.now() - timing.start;
  log(
    `📦  ${mode.padEnd(5)}: ${state.chunks.length.toLocaleString()} chunks, ${postings.tokenVocab.length.toLocaleString()} tokens, dims=${postings.dims}`
  );

  for (const entry of pieceEntries) {
    if (!entry?.path) continue;
    const metric = artifactMetrics.get(entry.path) || { path: entry.path };
    if (Number.isFinite(entry.count)) metric.count = entry.count;
    if (Number.isFinite(entry.dims)) metric.dims = entry.dims;
    if (entry.compression) metric.compression = entry.compression;
    artifactMetrics.set(entry.path, metric);
  }
  if (timing) {
    timing.artifacts = Array.from(artifactMetrics.values()).sort((a, b) => {
      const aPath = String(a?.path || '');
      const bPath = String(b?.path || '');
      return aPath.localeCompare(bPath);
    });
  }

  pieceEntries.sort((a, b) => {
    const pathA = String(a?.path || '');
    const pathB = String(b?.path || '');
    if (pathA !== pathB) return pathA.localeCompare(pathB);
    const typeA = String(a?.type || '');
    const typeB = String(b?.type || '');
    if (typeA !== typeB) return typeA.localeCompare(typeB);
    const nameA = String(a?.name || '');
    const nameB = String(b?.name || '');
    return nameA.localeCompare(nameB);
  });
  await writePiecesManifest({
    pieceEntries,
    outDir,
    mode,
    indexState
  });
  await writeIndexMetrics({
    root,
    userConfig,
    mode,
    outDir,
    state,
    postings,
    dictSummary,
    useStubEmbeddings,
    modelId,
    denseVectorsEnabled,
    incrementalEnabled,
    fileCounts,
    timing,
    perfProfile,
    indexState,
    filterIndexStats,
    resolvedTokenMode,
    tokenSampleSize,
    tokenMaxFiles,
    chunkMetaUseJsonl: chunkMetaPlan.chunkMetaUseJsonl,
    chunkMetaUseShards: chunkMetaPlan.chunkMetaUseShards,
    tokenPostingsUseShards,
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    documentExtractionEnabled,
    repoProvenance
  });
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { log, logLine, showProgress } from '../../shared/progress.js';
import { MAX_JSON_BYTES } from '../../shared/artifact-io.js';
import { toPosix } from '../../shared/files.js';
import { writeJsonObjectFile } from '../../shared/json-stream.js';
import { runWithConcurrency } from '../../shared/concurrency.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { ensureDiskSpace } from '../../shared/disk-space.js';
import { resolveCompressionConfig } from './artifacts/compression.js';
import { getToolingConfig } from '../../shared/dict-utils.js';
import { writePiecesManifest } from './artifacts/checksums.js';
import { writeFileLists } from './artifacts/file-lists.js';
import { buildFileMeta } from './artifacts/file-meta.js';
import { buildSerializedFilterIndex } from './artifacts/filter-index.js';
import { enqueueGraphRelationsArtifacts } from './artifacts/graph-relations.js';
import { writeIndexMetrics } from './artifacts/metrics.js';
import { enqueueRepoMapArtifacts, measureRepoMap } from './artifacts/repo-map.js';
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

/**
 * Write index artifacts and metrics.
 * @param {object} input
 */
export async function writeIndexArtifacts(input) {
  const {
    outDir,
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
    compressibleArtifacts
  } = resolveCompressionConfig(indexingConfig);
  const resolveShardCompression = (base) => (
    compressionEnabled && !compressionKeepRaw && compressibleArtifacts.has(base)
      ? compressionMode
      : null
  );
  const artifactConfig = indexingConfig.artifacts || {};
  const artifactMode = typeof artifactConfig.mode === 'string'
    ? artifactConfig.mode.toLowerCase()
    : 'auto';
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
  const maxJsonBytesSoft = maxJsonBytes * 0.9;
  const shardTargetBytes = maxJsonBytes * 0.75;
  const toolingConfig = getToolingConfig(root, userConfig);
  const vfsHashRouting = toolingConfig?.vfs?.hashRouting === true;
  const { fileMeta, fileIdByPath } = buildFileMeta(state);
  const chunkUidToFileId = new Map();
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
  const filterIndex = buildSerializedFilterIndex({
    chunks: state.chunks,
    resolvedConfig,
    userConfig,
    root
  });
  const filterIndexStats = summarizeFilterIndex(filterIndex);
  if (filterIndexStats?.jsonBytes && filterIndexStats.jsonBytes > maxJsonBytesSoft) {
    log(
      `filter_index ~${formatBytes(filterIndexStats.jsonBytes)}; ` +
      'large filter indexes increase memory usage (consider sqlite for large repos).'
    );
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
    maxJsonBytes,
    order: chunkMetaOrder
  });
  const chunkMetaPlan = resolveChunkMetaPlan({
    chunks: state.chunks,
    chunkMetaIterator,
    artifactMode,
    chunkMetaFormatConfig,
    chunkMetaJsonlThreshold,
    chunkMetaShardSize,
    maxJsonBytes
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
    maxJsonBytes,
    maxJsonBytesSoft,
    shardTargetBytes,
    log
  });
  tokenPostingsShardSize = resolvedTokenPostingsShardSize;
  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes: tokenPostingsEstimate?.estimatedBytes,
    label: `${mode} token_postings`
  });
  const removeArtifact = async (targetPath) => {
    try {
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
  const enqueueWrite = (label, job) => {
    writes.push({ label, job });
  };
  if (indexState && typeof indexState === 'object') {
    const indexStatePath = path.join(outDir, 'index_state.json');
    enqueueWrite(
      formatArtifactLabel(indexStatePath),
      () => writeJsonObjectFile(indexStatePath, { fields: indexState, atomic: true })
    );
    addPieceFile({ type: 'stats', name: 'index_state', format: 'json' }, indexStatePath);
  }
  const { enqueueJsonObject, enqueueJsonArray } = createArtifactWriter({
    outDir,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    compressionGzipOptions,
    compressibleArtifacts
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
  enqueueJsonArray('file_meta', fileMeta, {
    compressible: false,
    piece: { type: 'chunks', name: 'file_meta', count: fileMeta.length }
  });
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
  await enqueueChunkMetaArtifacts({
    state,
    outDir,
    mode,
    chunkMetaIterator,
    chunkMetaPlan,
    maxJsonBytes,
    compression: chunkMetaCompression,
    gzipOptions: chunkMetaCompression === 'gzip' ? compressionGzipOptions : null,
    enqueueJsonArray,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    stageCheckpoints
  });
  const chunkUidMapCompression = resolveShardCompression('chunk_uid_map');
  await enqueueChunkUidMapArtifacts({
    outDir,
    mode,
    chunks: state.chunks,
    maxJsonBytes,
    compression: chunkUidMapCompression,
    gzipOptions: chunkUidMapCompression === 'gzip' ? compressionGzipOptions : null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });
  const vfsManifestCompression = resolveShardCompression('vfs_manifest');
  await enqueueVfsManifestArtifacts({
    outDir,
    mode,
    rows: state.vfsManifestCollector || state.vfsManifestRows,
    maxJsonBytes,
    compression: vfsManifestCompression,
    gzipOptions: vfsManifestCompression === 'gzip' ? compressionGzipOptions : null,
    hashRouting: vfsHashRouting,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });
  const repoMapMeasurement = measureRepoMap({ repoMapIterator, maxJsonBytes });
  const useRepoMapJsonl = repoMapMeasurement.totalEntries
    && maxJsonBytes
    && repoMapMeasurement.totalBytes > maxJsonBytes;
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
    maxJsonBytes,
    repoMapCompression,
    compressionGzipOptions,
    log,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    removeArtifact
  });
  if (filterIndex) {
    enqueueJsonObject('filter_index', { fields: filterIndex }, {
      compressible: false,
      piece: { type: 'chunks', name: 'filter_index' }
    });
  }
  enqueueJsonObject('minhash_signatures', { arrays: { signatures: postings.minhashSigs } }, {
    piece: {
      type: 'postings',
      name: 'minhash_signatures',
      count: postings.minhashSigs.length
    }
  });
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
  enqueueFileRelationsArtifacts({
    state,
    outDir,
    maxJsonBytes,
    log,
    compression: fileRelationsCompression,
    gzipOptions: fileRelationsCompression === 'gzip' ? compressionGzipOptions : null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });
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
      maxJsonBytes,
      log,
      forceEmpty: callSitesRequired,
      compression: callSitesCompression,
      gzipOptions: callSitesCompression === 'gzip' ? compressionGzipOptions : null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel
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
      maxJsonBytes,
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
      maxJsonBytes,
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
  await enqueueGraphRelationsArtifacts({
    graphRelations,
    outDir,
    maxJsonBytes,
    log,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    removeArtifact
  });
  if (resolvedConfig.enablePhraseNgrams !== false) {
    enqueueJsonObject('phrase_ngrams', {
      arrays: { vocab: postings.phraseVocab, postings: postings.phrasePostings }
    }, {
      piece: { type: 'postings', name: 'phrase_ngrams', count: postings.phraseVocab.length }
    });
  }
  if (resolvedConfig.enableChargrams !== false) {
    enqueueJsonObject('chargram_postings', {
      arrays: { vocab: postings.chargramVocab, postings: postings.chargramPostings }
    }, {
      piece: { type: 'postings', name: 'chargram_postings', count: postings.chargramVocab.length }
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

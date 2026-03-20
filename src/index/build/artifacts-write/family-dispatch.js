import fs from 'node:fs/promises';
import path from 'node:path';

import { toPosix } from '../../../shared/files.js';
import { writeJsonObjectFile } from '../../../shared/json-stream.js';
import { createJsonWriteStream, writeChunkWithTiming } from '../../../shared/json-stream/streams.js';
import { estimateJsonBytes } from '../../../shared/cache.js';
import { removePathWithRetry } from '../../../shared/io/remove-path-with-retry.js';
import { ensureDiskSpace } from '../../../shared/disk-space.js';
import { CHARGRAM_HASH_META } from '../../../shared/chargram-hash.js';
import { computePackedChecksum } from '../../../shared/artifact-io/checksum.js';
import {
  resolveBinaryColumnarWriteHints,
  writeBinaryRowFrames
} from '../../../shared/artifact-io/binary-columnar.js';
import { SCHEDULER_QUEUE_NAMES } from '../runtime/scheduler.js';
import { buildFileMetaColumnar } from '../artifacts/file-meta.js';
import { enqueueGraphRelationsArtifacts } from '../artifacts/graph-relations.js';
import { enqueueRepoMapArtifacts, measureRepoMap } from '../artifacts/repo-map.js';
import { enqueueTokenPostingsArtifacts } from '../artifacts/token-postings.js';
import { enqueueFileRelationsArtifacts } from '../artifacts/writers/file-relations.js';
import { enqueueCallSitesArtifacts } from '../artifacts/writers/call-sites.js';
import { enqueueRiskInterproceduralArtifacts } from '../artifacts/writers/risk-interprocedural.js';
import { enqueueSymbolsArtifacts } from '../artifacts/writers/symbols.js';
import { enqueueSymbolOccurrencesArtifacts } from '../artifacts/writers/symbol-occurrences.js';
import { enqueueSymbolEdgesArtifacts } from '../artifacts/writers/symbol-edges.js';
import { enqueueChunkMetaArtifacts } from '../artifacts/writers/chunk-meta.js';
import { enqueueChunkUidMapArtifacts } from '../artifacts/writers/chunk-uid-map.js';
import { enqueueVfsManifestArtifacts } from '../artifacts/writers/vfs-manifest.js';
import {
  buildExtractionReport,
  buildLexiconRelationFilterReport
} from '../artifacts/reporting.js';
import {
  buildBoilerplateCatalog,
  writeBinaryArtifactAtomically
} from '../artifacts/write-runtime-helpers.js';
import {
  cleanupVectorOnlySparseArtifacts,
  removeCompressedArtifact,
  removePackedMinhash,
  removePackedPostings
} from '../artifacts/sparse-cleanup.js';
import { packMinhashSignatures } from '../artifacts/minhash-packed.js';

const cleanupPathExists = async (targetPath) => {
  if (!targetPath) return false;
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

export const prepareArtifactCleanup = async ({
  outDir,
  log,
  logLine,
  vectorOnlyProfile,
  tokenPostingsFormat,
  tokenPostingsUseShards,
  effectiveAbortSignal,
  indexState,
  profileId,
  removePieceFile
} = {}) => {
  const cleanupActions = [];
  const runCleanupBatch = async (operations, { concurrency = 3 } = {}) => {
    const tasks = Array.isArray(operations) ? operations.filter((op) => typeof op === 'function') : [];
    const batchSize = Number.isFinite(Number(concurrency))
      ? Math.max(1, Math.floor(Number(concurrency)))
      : 3;
    for (let i = 0; i < tasks.length; i += batchSize) {
      await Promise.all(tasks.slice(i, i + batchSize).map((task) => task()));
    }
  };
  const recordCleanupAction = ({ targetPath, recursive = false, policy = 'legacy' }) => {
    if (!targetPath) return;
    cleanupActions.push({
      path: toPosix(path.relative(outDir, targetPath)),
      recursive: recursive === true,
      policy
    });
  };
  const removeArtifact = async (targetPath, options = {}) => {
    const { recursive = true, policy = 'legacy' } = options;
    try {
      const exists = await cleanupPathExists(targetPath);
      if (exists) {
        logLine?.(`[artifact-cleanup] remove ${targetPath}`, { kind: 'status' });
        recordCleanupAction({ targetPath, recursive, policy });
      }
      const removed = await removePathWithRetry(targetPath, { recursive, force: true });
      if (removed?.ok) {
        removePieceFile?.(targetPath);
      }
      if (!removed.ok && exists) {
        log?.(`[warn] [artifact-cleanup] failed to remove ${targetPath}: ${removed.error?.message || removed.error}`);
      }
    } catch (err) {
      log?.(`[warn] [artifact-cleanup] exception removing ${targetPath}: ${err?.message || err}`);
    }
  };

  if (vectorOnlyProfile) {
    await cleanupVectorOnlySparseArtifacts({
      outDir,
      removeArtifact,
      abortSignal: effectiveAbortSignal
    });
  } else {
    if (tokenPostingsFormat === 'packed') {
      await runCleanupBatch([
        () => removeArtifact(path.join(outDir, 'token_postings.json'), { policy: 'format_cleanup' }),
        () => removeCompressedArtifact({ outDir, base: 'token_postings', removeArtifact }),
        () => removeArtifact(path.join(outDir, 'token_postings.meta.json'), { policy: 'format_cleanup' }),
        () => removeArtifact(path.join(outDir, 'token_postings.shards'), {
          recursive: true,
          policy: 'format_cleanup'
        })
      ]);
    } else {
      await removePackedPostings({ outDir, removeArtifact });
    }
    if (tokenPostingsUseShards) {
      await runCleanupBatch([
        () => removeArtifact(path.join(outDir, 'token_postings.json'), { policy: 'format_cleanup' }),
        () => removeCompressedArtifact({ outDir, base: 'token_postings', removeArtifact }),
        () => removeArtifact(path.join(outDir, 'token_postings.shards'), {
          recursive: true,
          policy: 'format_cleanup'
        })
      ]);
    } else {
      await runCleanupBatch([
        () => removeArtifact(path.join(outDir, 'token_postings.meta.json'), { policy: 'format_cleanup' }),
        () => removeArtifact(path.join(outDir, 'token_postings.shards'), {
          recursive: true,
          policy: 'format_cleanup'
        })
      ]);
    }
  }
  if (indexState && typeof indexState === 'object') {
    if (!indexState.extensions || typeof indexState.extensions !== 'object') {
      indexState.extensions = {};
    }
    indexState.extensions.artifactCleanup = {
      schemaVersion: 1,
      profileId,
      allowlistOnly: vectorOnlyProfile,
      actions: cleanupActions
    };
  }

  return {
    cleanupActions,
    runCleanupBatch,
    removeArtifact
  };
};

export const enqueueArtifactFamilyWrites = async (context = {}) => {
  const {
    outDir,
    root,
    mode,
    state,
    postings,
    indexState,
    indexingConfig,
    sparseArtifactsEnabled,
    documentExtractionEnabled,
    tinyRepoMinimalArtifacts,
    chunkMetaPlan,
    chunkMetaIterator,
    chunkMetaMaxBytes,
    chunkMetaBudget,
    chunkUidMapMaxBytes,
    chunkUidMapBudget,
    vfsMaxBytes,
    vfsBudget,
    repoMapIterator,
    repoMapMaxBytes,
    repoMapBudget,
    fileMeta,
    fileMetaFromCache,
    fileMetaMeta,
    fileMetaFingerprint,
    fileMetaCacheKey,
    fileMetaFormatConfig,
    fileMetaColumnarThreshold,
    fileMetaJsonlThreshold,
    fileMetaShardedMaxBytes,
    fileMetaMaxBytes,
    fileMetaBudget,
    fileIdByPath,
    chunkUidToFileId,
    maxJsonBytes,
    tokenPostingsFormat,
    tokenPostingsUseShards,
    tokenPostingsEstimate,
    tokenPostingsBinaryColumnar,
    fieldTokensShardThresholdBytes,
    fieldTokensShardMaxBytes,
    minhashJsonLargeThreshold,
    resolvedConfig,
    denseVectorsEnabled,
    symbolArtifactsFormatConfig,
    symbolOccurrencesMaxBytes,
    symbolOccurrencesBudget,
    symbolEdgesMaxBytes,
    symbolEdgesBudget,
    callSitesMaxBytes,
    callSitesBudget,
    fileRelationsMaxBytes,
    fileRelationsBudget,
    graphRelations,
    graphRelationsMaxBytes,
    graphRelationsBudget,
    scheduler,
    effectiveAbortSignal,
    riskInterproceduralEmitArtifacts,
    artifactWriteThroughputBytesPerSec,
    fieldPostingsShardsEnabled,
    fieldPostingsShardThresholdBytes,
    fieldPostingsShardCount,
    fieldPostingsShardMinCount,
    fieldPostingsShardMaxCount,
    fieldPostingsShardTargetBytes,
    fieldPostingsShardTargetSeconds,
    fieldPostingsKeepLegacyJson,
    fieldPostingsBinaryColumnar,
    fieldPostingsBinaryColumnarThresholdBytes,
    writeFsStrategy,
    runCleanupBatch,
    measureVocabOrdering,
    compressionGzipOptions,
    vfsHashRouting,
    resolveShardCompression,
    recordOrdering,
    formatBytes,
    applyByteBudget,
    addPieceFile,
    formatArtifactLabel,
    stageCheckpoints,
    enqueueWrite,
    enqueueJsonObject,
    enqueueJsonArray,
    enqueueJsonArraySharded,
    enqueueDenseBinaryArtifacts,
    removeArtifact,
    log
  } = context;

  if (mode === 'extracted-prose' && documentExtractionEnabled && !tinyRepoMinimalArtifacts) {
    const extractionReportPath = path.join(outDir, 'extraction_report.json');
    const extractionReport = buildExtractionReport({
      state,
      root,
      mode,
      documentExtractionConfig: indexingConfig.documentExtraction || {}
    });
    enqueueWrite(
      formatArtifactLabel(extractionReportPath),
      async () => {
        await writeJsonObjectFile(extractionReportPath, {
          fields: extractionReport,
          atomic: true
        });
      },
      {
        publishedPieces: [{
          entry: { type: 'stats', name: 'extraction_report', format: 'json' },
          filePath: extractionReportPath
        }]
      }
    );
  }

  const lexiconRelationFilterReport = tinyRepoMinimalArtifacts
    ? { files: [] }
    : buildLexiconRelationFilterReport({ state, mode });
  if (Array.isArray(lexiconRelationFilterReport.files) && lexiconRelationFilterReport.files.length) {
    const lexiconReportPath = path.join(outDir, 'lexicon_relation_filter_report.json');
    enqueueWrite(
      formatArtifactLabel(lexiconReportPath),
      async () => {
        await writeJsonObjectFile(lexiconReportPath, {
          fields: lexiconRelationFilterReport,
          atomic: true
        });
      },
      {
        publishedPieces: [{
          entry: { type: 'stats', name: 'lexicon_relation_filter_report', format: 'json' },
          filePath: lexiconReportPath
        }]
      }
    );
    if (indexState && typeof indexState === 'object') {
      if (!indexState.extensions || typeof indexState.extensions !== 'object') {
        indexState.extensions = {};
      }
      indexState.extensions.lexiconRelationFilter = {
        schemaVersion: 1,
        totals: lexiconRelationFilterReport.totals
      };
    }
  }

  const boilerplateCatalog = tinyRepoMinimalArtifacts
    ? []
    : buildBoilerplateCatalog(state?.chunks);
  if (boilerplateCatalog.length) {
    const boilerplateCatalogPath = path.join(outDir, 'boilerplate_catalog.json');
    enqueueWrite(
      formatArtifactLabel(boilerplateCatalogPath),
      async () => {
        await writeJsonObjectFile(boilerplateCatalogPath, {
          fields: {
            schemaVersion: '1.0.0',
            generatedAt: new Date().toISOString(),
            count: boilerplateCatalog.length,
            files: boilerplateCatalog
          },
          atomic: true
        });
      },
      {
        publishedPieces: [{
          entry: { type: 'stats', name: 'boilerplate_catalog', format: 'json' },
          filePath: boilerplateCatalogPath
        }]
      }
    );
  }

  if (denseVectorsEnabled) {
    enqueueDenseBinaryArtifacts({
      artifactName: 'dense_vectors',
      baseName: 'dense_vectors_uint8',
      vectors: postings.quantizedVectors,
      dims: postings.dims
    });
  } else {
    await removeArtifact(path.join(outDir, 'dense_vectors_uint8.json'));
    await removeCompressedArtifact({ outDir, base: 'dense_vectors_uint8', removeArtifact });
    await removeArtifact(path.join(outDir, 'dense_vectors_uint8.bin'));
    await removeArtifact(path.join(outDir, 'dense_vectors_uint8.bin.meta.json'));
    await removeArtifact(path.join(outDir, 'dense_vectors_doc_uint8.json'));
    await removeCompressedArtifact({ outDir, base: 'dense_vectors_doc_uint8', removeArtifact });
    await removeArtifact(path.join(outDir, 'dense_vectors_doc_uint8.bin'));
    await removeArtifact(path.join(outDir, 'dense_vectors_doc_uint8.bin.meta.json'));
    await removeArtifact(path.join(outDir, 'dense_vectors_code_uint8.json'));
    await removeCompressedArtifact({ outDir, base: 'dense_vectors_code_uint8', removeArtifact });
    await removeArtifact(path.join(outDir, 'dense_vectors_code_uint8.bin'));
    await removeArtifact(path.join(outDir, 'dense_vectors_code_uint8.bin.meta.json'));
  }

  const fileMetaEstimatedBytes = estimateJsonBytes(fileMeta);
  const fileMetaFormat = fileMetaFormatConfig || 'auto';
  const fileMetaExceedsMax = Number.isFinite(fileMetaMaxBytes)
    ? fileMetaEstimatedBytes > fileMetaMaxBytes
    : false;
  const fileMetaAutoUseJsonl = fileMetaFormat === 'auto'
    && Number.isFinite(fileMetaJsonlThreshold)
    && fileMetaJsonlThreshold > 0
    && fileMetaEstimatedBytes >= fileMetaJsonlThreshold;
  const fileMetaUseColumnar = !fileMetaExceedsMax
    && fileMetaFormat === 'columnar'
    && fileMetaEstimatedBytes >= fileMetaColumnarThreshold;
  const fileMetaUseJsonl = fileMetaFormat === 'jsonl'
    || fileMetaAutoUseJsonl
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
          await removeCompressedArtifact({ outDir, base: 'file_meta', removeArtifact });
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
        },
        {
          publishedPieces: [
            {
              entry: { type: 'chunks', name: 'file_meta', format: 'columnar', count: fileMeta.length },
              filePath: columnarPath
            }
          ]
        }
      );
    } else if (fileMetaUseJsonl) {
      enqueueWrite(
        formatArtifactLabel(path.join(outDir, 'file_meta.parts')),
        async () => {
          await removeArtifact(path.join(outDir, 'file_meta.json'));
          await removeCompressedArtifact({ outDir, base: 'file_meta', removeArtifact });
        }
      );
      enqueueJsonArraySharded('file_meta', fileMeta, {
        maxBytes: fileMetaShardedMaxBytes || fileMetaMaxBytes,
        estimatedBytes: fileMetaEstimatedBytes,
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
    } else {
      addPieceFile({ type: 'chunks', name: 'file_meta', format: 'json', count: fileMeta.length }, path.join(outDir, 'file_meta.json'));
    }
  }

  if (denseVectorsEnabled) {
    enqueueDenseBinaryArtifacts({
      artifactName: 'dense_vectors_doc',
      baseName: 'dense_vectors_doc_uint8',
      vectors: postings.quantizedDocVectors,
      dims: postings.dims
    });
    enqueueDenseBinaryArtifacts({
      artifactName: 'dense_vectors_code',
      baseName: 'dense_vectors_code_uint8',
      vectors: postings.quantizedCodeVectors,
      dims: postings.dims
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
    gzipOptions: chunkMetaCompression === 'gzip' ? context.compressionGzipOptions : null,
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
    gzipOptions: chunkUidMapCompression === 'gzip' ? context.compressionGzipOptions : null,
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
    gzipOptions: vfsManifestCompression === 'gzip' ? context.compressionGzipOptions : null,
    hashRouting: context.vfsHashRouting,
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
    compressionGzipOptions: context.compressionGzipOptions,
    log,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    removeArtifact,
    stageCheckpoints
  });
  await recordOrdering('repo_map', repoMapMeasurement, 'repo_map:file,name,kind,signature,startLine');
  return;

  if (filterIndex) {
    enqueueJsonObject('filter_index', { fields: filterIndex }, {
      compressible: false,
      piece: { type: 'chunks', name: 'filter_index' }
    });
  } else if (filterIndexFallback?.path) {
    const normalizedFilterIndexPath = formatArtifactLabel(filterIndexFallback.path);
    filterIndexFallback.piece.path = normalizedFilterIndexPath;
    addPieceFile(filterIndexFallback.piece, filterIndexFallback.path);
    if (indexState?.filterIndex && typeof indexState.filterIndex === 'object') {
      indexState.filterIndex.path = normalizedFilterIndexPath;
    }
  }

  const minhashFromPostings = Array.isArray(postings.minhashSigs) && postings.minhashSigs.length
    ? postings.minhashSigs
    : null;
  const minhashSamplingMeta = postings?.minhashGuard?.sampled === true
    ? {
      mode: typeof postings?.minhashGuard?.mode === 'string'
        ? postings.minhashGuard.mode
        : 'sampled-minified',
      maxDocs: Number.isFinite(Number(postings?.minhashGuard?.maxDocs))
        ? Math.max(0, Math.floor(Number(postings.minhashGuard.maxDocs)))
        : null,
      totalDocs: Number.isFinite(Number(postings?.minhashGuard?.totalDocs))
        ? Math.max(0, Math.floor(Number(postings.minhashGuard.totalDocs)))
        : null,
      signatureLength: Number.isFinite(Number(postings?.minhashGuard?.signatureLength))
        ? Math.max(0, Math.floor(Number(postings.minhashGuard.signatureLength)))
        : null,
      sampledSignatureLength: Number.isFinite(Number(postings?.minhashGuard?.sampledSignatureLength))
        ? Math.max(0, Math.floor(Number(postings.minhashGuard.sampledSignatureLength)))
        : null,
      hashStride: Number.isFinite(Number(postings?.minhashGuard?.hashStride))
        ? Math.max(1, Math.floor(Number(postings.minhashGuard.hashStride)))
        : null,
      density: Number.isFinite(Number(postings?.minhashGuard?.density))
        ? Number(postings.minhashGuard.density)
        : null
    }
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
  const packedMinhash = sparseArtifactsEnabled
    ? packMinhashSignatures({
      signatures: minhashFromPostings,
      chunks: minhashStream ? state.chunks : null
    })
    : null;
  if (packedMinhash?.coercedRows && typeof log === 'function') {
    log(
      `[minhash] packed signatures coerced ${packedMinhash.coercedRows} row(s) `
      + `to match dims=${packedMinhash.dims}.`
    );
  }
  const skipMinhashJsonForLarge = sparseArtifactsEnabled
    && packedMinhash
    && minhashCount >= minhashJsonLargeThreshold;
  if (skipMinhashJsonForLarge && typeof log === 'function') {
    log(
      `[minhash] skipping minhash_signatures.json for large index `
      + `(count=${minhashCount}, threshold=${minhashJsonLargeThreshold}); using packed artifact.`
    );
  }
  if (skipMinhashJsonForLarge) {
    await runCleanupBatch([
      () => removeArtifact(path.join(outDir, 'minhash_signatures.json'), { policy: 'format_cleanup' }),
      () => removeArtifact(path.join(outDir, 'minhash_signatures.json.gz'), { policy: 'format_cleanup' }),
      () => removeArtifact(path.join(outDir, 'minhash_signatures.json.zst'), { policy: 'format_cleanup' }),
      () => removeArtifact(path.join(outDir, 'minhash_signatures.meta.json'), { policy: 'format_cleanup' }),
      () => removeArtifact(path.join(outDir, 'minhash_signatures.parts'), {
        recursive: true,
        policy: 'format_cleanup'
      })
    ]);
  }
  if (sparseArtifactsEnabled && !skipMinhashJsonForLarge) {
    enqueueJsonObject('minhash_signatures', {
      fields: minhashSamplingMeta ? { sampling: minhashSamplingMeta } : undefined,
      arrays: { signatures: minhashIterable }
    }, {
      piece: {
        type: 'postings',
        name: 'minhash_signatures',
        count: minhashCount
      }
    });
  }
  if (packedMinhash) {
    const packedChecksum = computePackedChecksum(packedMinhash.buffer);
    const packedPath = path.join(outDir, 'minhash_signatures.packed.bin');
    const packedMetaPath = path.join(outDir, 'minhash_signatures.packed.meta.json');
    enqueueWrite(
      formatArtifactLabel(packedPath),
      async () => {
        await writeBinaryArtifactAtomically(packedPath, packedMinhash.buffer);
        await writeJsonObjectFile(packedMetaPath, {
          fields: {
            format: 'u32',
            endian: 'le',
            dims: packedMinhash.dims,
            count: packedMinhash.count,
            checksum: packedChecksum.hash,
            ...(minhashSamplingMeta ? { sampling: minhashSamplingMeta } : {})
          },
          atomic: true
        });
      },
      {
        publishedPieces: [
          {
            entry: {
              type: 'postings',
              name: 'minhash_signatures_packed',
              format: 'bin',
              count: packedMinhash.count
            },
            filePath: packedPath
          },
          {
            entry: { type: 'postings', name: 'minhash_signatures_packed_meta', format: 'json' },
            filePath: packedMetaPath
          }
        ]
      }
    );
  } else {
    await removePackedMinhash({ outDir, removeArtifact });
  }

  const tokenPostingsCompression = resolveShardCompression('token_postings');
  if (sparseArtifactsEnabled) {
    await enqueueTokenPostingsArtifacts({
      outDir,
      postings,
      state,
      tokenPostingsFormat,
      tokenPostingsUseShards,
      tokenPostingsShardSize: tokenPostingsEstimate?.estimatedShardSize || tokenPostingsEstimate?.shardSize || null,
      tokenPostingsBinaryColumnar,
      tokenPostingsCompression,
      writePriority: 210,
      tokenPostingsEstimatedBytes: tokenPostingsEstimate?.estimatedBytes || null,
      enqueueJsonObject,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel
    });
  }

  const vocabOrder = {};
  const tokenOrdering = measureVocabOrdering(postings.tokenVocab);
  await recordOrdering('token_vocab', tokenOrdering, 'token_vocab:token');
  if (tokenOrdering.orderingHash) {
    vocabOrder.token = {
      hash: tokenOrdering.orderingHash,
      count: tokenOrdering.orderingCount
    };
  }

  if (sparseArtifactsEnabled && resolvedConfig.fielded !== false && Array.isArray(state.fieldTokens)) {
    const fieldTokensEstimatedBytes = estimateJsonBytes(state.fieldTokens);
    const fieldTokensUseShards = fieldTokensShardThresholdBytes > 0
      && fieldTokensShardMaxBytes > 0
      && fieldTokensEstimatedBytes >= fieldTokensShardThresholdBytes;
    if (fieldTokensUseShards) {
      enqueueWrite(
        formatArtifactLabel(path.join(outDir, 'field_tokens.parts')),
        async () => {
          await removeArtifact(path.join(outDir, 'field_tokens.json'), { policy: 'format_cleanup' });
          await removeArtifact(path.join(outDir, 'field_tokens.json.gz'), { policy: 'format_cleanup' });
          await removeArtifact(path.join(outDir, 'field_tokens.json.zst'), { policy: 'format_cleanup' });
        }
      );
      if (typeof log === 'function') {
        log(
          `field_tokens estimate ~${formatBytes(fieldTokensEstimatedBytes)}; `
          + `using jsonl-sharded output (target ${formatBytes(fieldTokensShardMaxBytes)}).`
        );
      }
      enqueueJsonArraySharded('field_tokens', state.fieldTokens, {
        maxBytes: fieldTokensShardMaxBytes,
        estimatedBytes: fieldTokensEstimatedBytes,
        piece: { type: 'postings', name: 'field_tokens', count: state.fieldTokens.length },
        compression: null,
        gzipOptions: null,
        offsets: true
      });
    } else {
      enqueueWrite(
        formatArtifactLabel(path.join(outDir, 'field_tokens.parts')),
        async () => {
          await removeArtifact(path.join(outDir, 'field_tokens.meta.json'), { policy: 'format_cleanup' });
          await removeArtifact(path.join(outDir, 'field_tokens.parts'), {
            recursive: true,
            policy: 'format_cleanup'
          });
        }
      );
      enqueueJsonArray('field_tokens', state.fieldTokens, {
        piece: { type: 'postings', name: 'field_tokens', count: state.fieldTokens.length }
      });
    }
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
  const riskPartialFlowsCompression = resolveShardCompression('risk_partial_flows');
  if (mode === 'code' && state?.riskInterproceduralStats) {
    enqueueRiskInterproceduralArtifacts({
      state,
      outDir,
      maxJsonBytes,
      log,
      compression: riskSummariesCompression,
      flowsCompression: riskPartialFlowsCompression || riskFlowsCompression,
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
      formatArtifactLabel,
      stageCheckpoints
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
      {
        cpu: 1,
        mem: 1,
        signal: effectiveAbortSignal
      },
      fn
    )
    : (fn) => fn();
  const scheduleRelationsIo = scheduler?.schedule
    ? (fn) => scheduler.schedule(
      SCHEDULER_QUEUE_NAMES.stage2RelationsIo,
      {
        io: 1,
        signal: effectiveAbortSignal
      },
      fn
    )
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
  if (sparseArtifactsEnabled && resolvedConfig.enablePhraseNgrams !== false) {
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
  if (sparseArtifactsEnabled && resolvedConfig.enableChargrams !== false) {
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
  if (sparseArtifactsEnabled && Object.keys(vocabOrder).length) {
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
};

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getEffectiveConfigHash, getMetricsDir, getToolVersion } from '../../../shared/dict-utils.js';
import { writeJsonObjectFile } from '../../../shared/json-stream.js';

export const writeIndexMetrics = async ({
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
  chunkMetaUseJsonl,
  chunkMetaUseShards,
  tokenPostingsUseShards,
  compressionEnabled,
  compressionMode,
  compressionKeepRaw,
  documentExtractionEnabled,
  repoProvenance = null
}) => {
  const cacheHits = state.scannedFilesTimes.filter((entry) => entry.cached).length;
  const cacheMisses = state.scannedFilesTimes.length - cacheHits;
  const skippedByReason = state.skippedFiles.reduce((acc, entry) => {
    const reason = entry && typeof entry === 'object' && entry.reason
      ? String(entry.reason)
      : 'unknown';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const toolVersion = getToolVersion();
  const effectiveConfigHash = getEffectiveConfigHash(root, userConfig);
  const resolvedProvenance = repoProvenance && typeof repoProvenance === 'object'
    ? repoProvenance
    : null;
  const repoBranch = resolvedProvenance?.head?.branch ?? resolvedProvenance?.branch ?? null;
  const repoIsRepo = resolvedProvenance?.isRepo ?? null;
  const metrics = {
    generatedAt: new Date().toISOString(),
    tool: {
      version: toolVersion,
      node: process.version,
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch()
      },
      configHash: effectiveConfigHash
    },
    repo: {
      provenance: resolvedProvenance
    },
    repoRoot: path.resolve(root),
    mode,
    indexDir: path.resolve(outDir),
    incremental: incrementalEnabled,
    git: { branch: repoBranch, isRepo: repoIsRepo },
    cache: {
      hits: cacheHits,
      misses: cacheMisses,
      hitRate: state.scannedFilesTimes.length ? cacheHits / state.scannedFilesTimes.length : 0
    },
    files: {
      scanned: state.scannedFiles.length,
      skipped: state.skippedFiles.length,
      candidates: fileCounts.candidates,
      skippedByReason
    },
    chunks: {
      total: state.chunks.length,
      avgTokens: state.chunks.length ? state.totalTokens / state.chunks.length : 0
    },
    tokens: {
      total: state.totalTokens,
      vocab: postings.tokenVocab.length
    },
    bm25: {
      k1: postings.k1,
      b: postings.b,
      avgChunkLen: postings.avgChunkLen,
      totalDocs: postings.totalDocs
    },
    embeddings: {
      dims: postings.dims,
      stub: useStubEmbeddings,
      model: modelId,
      enabled: denseVectorsEnabled
    },
    dictionaries: dictSummary,
    artifacts: {
      chunkTokens: {
        mode: resolvedTokenMode,
        sampleSize: tokenSampleSize,
        maxFiles: tokenMaxFiles
      },
      filterIndex: filterIndexStats || null,
      formats: {
        chunkMeta: chunkMetaUseShards ? 'jsonl-sharded' : (chunkMetaUseJsonl ? 'jsonl' : 'json'),
        tokenPostings: tokenPostingsUseShards ? 'sharded' : 'json'
      },
      compression: {
        enabled: Boolean(compressionEnabled),
        mode: compressionMode,
        keepRaw: compressionKeepRaw
      },
      documentExtraction: {
        enabled: Boolean(documentExtractionEnabled)
      }
    },
    queues: {
      postings: timing?.postingsQueue || state?.postingsQueueStats || null
    },
    timings: timing
  };
  try {
    const metricsDir = getMetricsDir(root, userConfig);
    await fs.mkdir(metricsDir, { recursive: true });
    await writeJsonObjectFile(
      path.join(metricsDir, `index-${mode}.json`),
      { fields: metrics, atomic: true }
    );
    if (perfProfile) {
      await writeJsonObjectFile(
        path.join(metricsDir, `perf-profile-${mode}.json`),
        { fields: perfProfile, atomic: true }
      );
    }
  } catch (err) {
    const message = err?.message || String(err);
    console.warn(`[metrics] Failed to write metrics for ${mode}: ${message}`);
  }
};

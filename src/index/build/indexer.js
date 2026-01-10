import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyAdaptiveDictConfig, getCacheRoot, getIndexDir, getMetricsDir } from '../../../tools/dict-utils.js';
import { buildRecordsIndexForRepo } from '../../integrations/triage/index-records.js';
import { applyCrossFileInference } from '../type-inference-crossfile.js';
import { createTaskQueues, runWithConcurrency, runWithQueue } from '../../shared/concurrency.js';
import { createCacheReporter } from '../../shared/cache.js';
import { log, logLine, showProgress } from '../../shared/progress.js';
import { toPosix } from '../../shared/files.js';
import { getEnvConfig } from '../../shared/env.js';
import { countLinesForEntries } from '../../shared/file-stats.js';
import { writeIndexArtifacts } from './artifacts.js';
import { estimateContextWindow } from './context-window.js';
import { discoverFiles } from './discover.js';
import { createCrashLogger } from './crash-log.js';
import { createFileProcessor } from './file-processor.js';
import { buildImportLinksFromRelations, scanImports } from './imports.js';
import { loadIncrementalState, pruneIncrementalManifest, shouldReuseIncrementalIndex, updateBundlesWithChunks } from './incremental.js';
import { buildPostings } from './postings.js';
import {
  applyTokenRetention,
  appendChunk,
  createIndexState,
  mergeIndexState,
  normalizeTokenRetention
} from './state.js';
import { configureGitMetaCache } from '../git.js';
import { loadStructuralMatches } from '../structural.js';
import { sha1 } from '../../shared/hash.js';
import { planShards } from './shards.js';
import { ensureQueueDir, enqueueJob } from '../../../tools/service/queue.js';   
import { createBuildCheckpoint } from './build-state.js';
import { createPerfProfile, finalizePerfProfile, loadPerfProfile, recordFileMetric } from './perf-profile.js';

const buildTokenizationKey = (runtime, mode) => {
  const commentsConfig = runtime.commentsConfig || {};
  const payload = {
    mode,
    dictConfig: runtime.dictConfig || {},
    postingsConfig: runtime.postingsConfig || {},
    dictSignature: runtime.dictSignature || null,
    segmentsConfig: runtime.segmentsConfig || {},
    commentsConfig: {
      ...commentsConfig,
      licensePattern: commentsConfig.licensePattern?.source || null,
      generatedPattern: commentsConfig.generatedPattern?.source || null,
      linterPattern: commentsConfig.linterPattern?.source || null
    }
  };
  return sha1(JSON.stringify(payload));
};

const buildIncrementalSignature = (runtime, mode, tokenizationKey) => {
  const languageOptions = runtime.languageOptions || {};
  const payload = {
    mode,
    tokenizationKey,
    features: {
      astDataflowEnabled: runtime.astDataflowEnabled,
      controlFlowEnabled: runtime.controlFlowEnabled,
      lintEnabled: runtime.lintEnabled,
      complexityEnabled: runtime.complexityEnabled,
      riskAnalysisEnabled: runtime.riskAnalysisEnabled,
      riskAnalysisCrossFileEnabled: runtime.riskAnalysisCrossFileEnabled,
      typeInferenceEnabled: runtime.typeInferenceEnabled,
      typeInferenceCrossFileEnabled: runtime.typeInferenceCrossFileEnabled,
      gitBlameEnabled: runtime.gitBlameEnabled
    },
    riskRules: runtime.indexingConfig?.riskRules || null,
    riskCaps: runtime.indexingConfig?.riskCaps || null,
    parsers: {
      javascript: languageOptions.javascript?.parser || null,
      javascriptFlow: languageOptions.javascript?.flow || null,
      typescript: languageOptions.typescript?.parser || null,
      typescriptImportsOnly: languageOptions.typescript?.importsOnly === true
    },
    treeSitter: languageOptions.treeSitter
      ? {
        enabled: languageOptions.treeSitter.enabled !== false,
        languages: languageOptions.treeSitter.languages || {},
        configChunking: languageOptions.treeSitter.configChunking === true,
        maxBytes: languageOptions.treeSitter.maxBytes ?? null,
        maxLines: languageOptions.treeSitter.maxLines ?? null,
        maxParseMs: languageOptions.treeSitter.maxParseMs ?? null,
        byLanguage: languageOptions.treeSitter.byLanguage || {}
      }
      : { enabled: false },
    importScan: runtime.indexingConfig?.importScan ?? null,
    yamlChunking: languageOptions.yamlChunking || null,
    kotlin: languageOptions.kotlin || null,
    embeddings: {
      enabled: runtime.embeddingEnabled || runtime.embeddingService,
      mode: runtime.embeddingMode,
      service: runtime.embeddingService === true,
      batchSize: runtime.embeddingBatchSize
    },
    fileCaps: runtime.fileCaps,
    fileScan: runtime.fileScan
  };
  return sha1(JSON.stringify(payload));
};

const enqueueEmbeddingJob = async ({ runtime, mode }) => {
  if (!runtime.embeddingService) return null;
  const queueDir = runtime.embeddingQueue?.dir
    ? path.resolve(runtime.embeddingQueue.dir)
    : path.join(getCacheRoot(), 'service', 'queue');
  const maxQueued = Number.isFinite(runtime.embeddingQueue?.maxQueued)
    ? runtime.embeddingQueue.maxQueued
    : null;
  const jobId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  await ensureQueueDir(queueDir);
  const result = await enqueueJob(
    queueDir,
    {
      id: jobId,
      createdAt: new Date().toISOString(),
      repo: runtime.root,
      mode,
      reason: 'embeddings'
    },
    maxQueued,
    'embeddings'
  );
  if (!result.ok) {
    log(`[embeddings] Queue full or unavailable; skipped enqueue.`);
    return null;
  }
  log(`[embeddings] Queued embedding job ${jobId} (${mode}).`);
  return result.job || null;
};

/**
 * Build indexes for a given mode.
 * @param {{mode:'code'|'prose'|'records'|'extracted-prose',runtime:object,discovery?:{entries:Array,skippedFiles:Array}}} input
 */
export async function buildIndexForMode({ mode, runtime, discovery = null }) {
  if (mode === 'records') {
    await buildRecordsIndexForRepo({ runtime });
    return;
  }
  const crashLogger = await createCrashLogger({
    repoCacheRoot: runtime.repoCacheRoot,
    enabled: runtime.debugCrash,
    log
  });
  const outDir = getIndexDir(runtime.root, mode, runtime.userConfig, { indexRoot: runtime.buildRoot });
  await fs.mkdir(outDir, { recursive: true });
  log(`\n📄  Scanning ${mode} …`);
  const timing = { start: Date.now() };
  const metricsDir = getMetricsDir(runtime.root, runtime.userConfig);
  const perfFeatures = {
    stage: runtime.stage || null,
    embeddings: runtime.embeddingEnabled || runtime.embeddingService,
    treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false,
    relations: runtime.stage !== 'stage1',
    tooling: runtime.toolingEnabled,
    typeInference: runtime.typeInferenceEnabled,
    riskAnalysis: runtime.riskAnalysisEnabled
  };
  const perfProfile = createPerfProfile({
    configHash: runtime.configHash,
    mode,
    buildId: runtime.buildId,
    features: perfFeatures
  });
  const priorPerfProfile = await loadPerfProfile({
    metricsDir,
    mode,
    configHash: runtime.configHash,
    log
  });
  const shardPerfProfile = priorPerfProfile?.totals?.durationMs
    ? priorPerfProfile
    : null;
  crashLogger.updatePhase(`scan:${mode}`);

  const state = createIndexState();
  if (discovery && Array.isArray(discovery.skippedFiles)) {
    state.skippedFiles.push(...discovery.skippedFiles);
  }
  const cacheReporter = createCacheReporter({ enabled: runtime.verboseCache, log });
  const seenFiles = new Set();

  log('Discovering files...');
  const discoverStart = Date.now();
  let allEntries = null;
  if (discovery && Array.isArray(discovery.entries)) {
    allEntries = discovery.entries.slice();
    log('→ Reusing shared discovery results.');
  } else {
    allEntries = await runtime.queues.io.add(() => discoverFiles({
      root: runtime.root,
      mode,
      ignoreMatcher: runtime.ignoreMatcher,
      skippedFiles: state.skippedFiles,
      maxFileBytes: runtime.maxFileBytes,
      fileCaps: runtime.fileCaps
    }));
  }
  allEntries.sort((a, b) => a.rel.localeCompare(b.rel));
  log(`→ Found ${allEntries.length} files.`);
  timing.discoverMs = Date.now() - discoverStart;
  runtime.dictConfig = applyAdaptiveDictConfig(runtime.dictConfig, allEntries.length);
  const tokenizationKey = buildTokenizationKey(runtime, mode);
  const cacheSignature = buildIncrementalSignature(runtime, mode, tokenizationKey);
  const incrementalState = await loadIncrementalState({
    repoCacheRoot: runtime.repoCacheRoot,
    mode,
    enabled: runtime.incrementalEnabled,
    tokenizationKey,
    cacheSignature,
    log
  });
  configureGitMetaCache(runtime.cacheConfig?.gitMeta, cacheReporter);

  if (incrementalState?.enabled) {
    const reuse = await shouldReuseIncrementalIndex({
      outDir,
      entries: allEntries,
      manifest: incrementalState.manifest,
      stage: runtime.stage
    });
    if (reuse) {
      log(`→ Reusing ${mode} index artifacts (no changes).`);
      cacheReporter.report();
      return;
    }
  }

  const relationsEnabled = runtime.stage !== 'stage1';
  const importScanRaw = runtime.indexingConfig?.importScan;
  const importScanMode = typeof importScanRaw === 'string'
    ? importScanRaw.trim().toLowerCase()
    : (importScanRaw === false ? 'off' : 'post');
  const enableImportLinks = importScanMode !== 'off';
  const usePreScan = importScanMode === 'pre' || importScanMode === 'prescan';
  let importResult = { allImports: {}, durationMs: 0, stats: null };
  if (mode === 'code' && relationsEnabled && enableImportLinks && usePreScan) {
    log('Scanning for imports...');
    crashLogger.updatePhase('imports');
    importResult = await scanImports({
      files: allEntries,
      root: runtime.root,
      mode,
      languageOptions: runtime.languageOptions,
      importConcurrency: runtime.importConcurrency,
      queue: runtime.queues.io,
      incrementalState
    });
    timing.importsMs = importResult.durationMs;
    if (importResult?.stats) {
      const { modules, edges, files } = importResult.stats;
      log(`→ Imports: modules=${modules}, edges=${edges}, files=${files}`);
    }
  } else if (mode === 'code' && relationsEnabled && enableImportLinks) {
    log('Skipping import pre-scan; will enrich import links from relations.');
  } else if (mode === 'code' && relationsEnabled) {
    log('Import link enrichment disabled via indexing.importScan.');
  } else if (mode === 'code') {
    log('Skipping import scan for sparse stage.');
  }

  const contextWin = await estimateContextWindow({
    files: allEntries.map((entry) => entry.abs),
    root: runtime.root,
    mode,
    languageOptions: runtime.languageOptions
  });
  log(`Auto-selected context window: ${contextWin} lines`);

  log('Processing and indexing files...');
  crashLogger.updatePhase('processing');
  const processStart = Date.now();
  log(`Indexing concurrency: files=${runtime.fileConcurrency}, imports=${runtime.importConcurrency}, io=${runtime.ioConcurrency}, cpu=${runtime.cpuConcurrency}`);
  const envConfig = getEnvConfig();
  const showFileProgress = envConfig.progressFiles === true;

  const structuralMatches = loadStructuralMatches({
    repoRoot: runtime.root,
    repoCacheRoot: runtime.repoCacheRoot,
    log
  });
  const tokenizationStats = {
    chunks: 0,
    tokens: 0,
    seq: 0,
    ngrams: 0,
    chargrams: 0
  };
  const checkpoint = createBuildCheckpoint({
    buildRoot: runtime.buildRoot,
    mode,
    totalFiles: allEntries.length
  });
  const progress = {
    total: allEntries.length,
    count: 0,
    tick() {
      this.count += 1;
      showProgress('Files', this.count, this.total);
      checkpoint.tick();
    }
  };
  const indexingConfig = runtime.userConfig?.indexing || {};
  const tokenModeRaw = indexingConfig.chunkTokenMode || 'auto';
  const tokenMode = ['auto', 'full', 'sample', 'none'].includes(tokenModeRaw)
    ? tokenModeRaw
    : 'auto';
  const tokenMaxFiles = Number.isFinite(Number(indexingConfig.chunkTokenMaxFiles))
    ? Math.max(0, Number(indexingConfig.chunkTokenMaxFiles))
    : 5000;
  const tokenMaxTotalRaw = Number(indexingConfig.chunkTokenMaxTokens);
  const tokenMaxTotal = Number.isFinite(tokenMaxTotalRaw) && tokenMaxTotalRaw > 0
    ? Math.floor(tokenMaxTotalRaw)
    : 5000000;
  const tokenSampleSize = Number.isFinite(Number(indexingConfig.chunkTokenSampleSize))
    ? Math.max(1, Math.floor(Number(indexingConfig.chunkTokenSampleSize)))
    : 32;
  let resolvedTokenMode = tokenMode === 'auto'
    ? (allEntries.length <= tokenMaxFiles ? 'full' : 'sample')
    : tokenMode;
  const tokenRetention = normalizeTokenRetention({
    mode: resolvedTokenMode,
    sampleSize: tokenSampleSize
  });
  const tokenRetentionAuto = tokenMode === 'auto';
  let tokenTotal = 0;
  const applyRetentionToState = (target) => {
    if (!target?.chunks) return;
    for (const chunk of target.chunks) {
      applyTokenRetention(chunk, tokenRetention);
    }
  };
  const handleFileResult = (result, stateRef, shardMeta = null) => {
    if (!result) return;
    if (result.fileMetrics) {
      recordFileMetric(perfProfile, result.fileMetrics);
    }
    for (const chunk of result.chunks) {
      const seqLen = Array.isArray(chunk.seq) && chunk.seq.length
        ? chunk.seq.length
        : (Array.isArray(chunk.tokens) ? chunk.tokens.length : 0);
      tokenTotal += seqLen;
      appendChunk(stateRef, { ...chunk }, runtime.postingsConfig, tokenRetention);
    }
    if (tokenRetentionAuto && tokenRetention.mode === 'full'
      && tokenMaxTotal
      && tokenTotal > tokenMaxTotal) {
      tokenRetention.mode = 'sample';
      applyRetentionToState(state);
      if (stateRef !== state) applyRetentionToState(stateRef);
      log(`Chunk token mode auto -> sample (token budget ${tokenTotal} > ${tokenMaxTotal}).`);
    }
    stateRef.scannedFilesTimes.push({ file: result.abs, duration_ms: result.durationMs, cached: result.cached });
    stateRef.scannedFiles.push(result.abs);
    if (result.manifestEntry) {
      if (shardMeta?.id) result.manifestEntry.shard = shardMeta.id;
      incrementalState.manifest.files[result.relKey] = result.manifestEntry;
    }
    if (result.fileRelations) {
      stateRef.fileRelations.set(result.relKey, result.fileRelations);
    }
  };
  const createShardRuntime = (baseRuntime, { fileConcurrency, importConcurrency, embeddingConcurrency }) => {
    const ioConcurrency = Math.max(fileConcurrency, importConcurrency);
    const cpuLimit = Math.max(1, os.cpus().length * 2);
    const cpuConcurrency = Math.max(1, Math.min(cpuLimit, fileConcurrency));    
    const maxFilePending = Math.min(10000, fileConcurrency * 1000);
    const maxIoPending = Math.min(10000, ioConcurrency * 1000);
    const maxEmbeddingPending = Math.min(64, embeddingConcurrency * 8);
    const queues = createTaskQueues({
      ioConcurrency,
      cpuConcurrency,
      embeddingConcurrency,
      ioPendingLimit: maxIoPending,
      cpuPendingLimit: maxFilePending,
      embeddingPendingLimit: maxEmbeddingPending
    });
    return {
      ...baseRuntime,
      fileConcurrency,
      importConcurrency,
      ioConcurrency,
      cpuConcurrency,
      embeddingConcurrency,
      queues
    };
  };
  const processEntries = async ({ entries, runtime: runtimeRef, shardMeta = null, stateRef }) => {
    const shardLabel = shardMeta?.label || shardMeta?.id || null;
    const { processFile } = createFileProcessor({
      root: runtimeRef.root,
      mode,
      dictConfig: runtimeRef.dictConfig,
      dictWords: runtimeRef.dictWords,
      languageOptions: runtimeRef.languageOptions,
      postingsConfig: runtimeRef.postingsConfig,
      segmentsConfig: runtimeRef.segmentsConfig,
      commentsConfig: runtimeRef.commentsConfig,
      allImports: importResult.allImports,
      contextWin,
      incrementalState,
      getChunkEmbedding: runtimeRef.getChunkEmbedding,
      getChunkEmbeddings: runtimeRef.getChunkEmbeddings,
      embeddingBatchSize: runtimeRef.embeddingBatchSize,
      embeddingEnabled: runtimeRef.embeddingEnabled,
      typeInferenceEnabled: runtimeRef.typeInferenceEnabled,
      riskAnalysisEnabled: runtimeRef.riskAnalysisEnabled,
      riskConfig: runtimeRef.riskConfig,
      toolInfo: runtimeRef.toolInfo,
      seenFiles,
      gitBlameEnabled: runtimeRef.gitBlameEnabled,
      lintEnabled: runtimeRef.lintEnabled,
      complexityEnabled: runtimeRef.complexityEnabled,
      tokenizationStats,
      structuralMatches,
      cacheConfig: runtimeRef.cacheConfig,
      cacheReporter,
      queues: runtimeRef.queues,
      useCpuQueue: false,
      workerPool: runtimeRef.workerPool,
      crashLogger,
      relationsEnabled,
      skippedFiles: stateRef.skippedFiles,
      fileCaps: runtimeRef.fileCaps,
      fileScan: runtimeRef.fileScan
    });
    await runWithQueue(
      runtimeRef.queues.cpu,
      entries,
      async (entry, fileIndex) => {
        if (showFileProgress) {
          const rel = entry.rel || toPosix(path.relative(runtimeRef.root, entry.abs));
          const shardText = shardLabel ? `shard ${shardLabel}` : 'shard';
          const shardPrefix = `[${shardText}]`;
          const countText = `${progress.count + 1}/${progress.total}`;
          const lineText = Number.isFinite(entry.lines) ? `lines ${entry.lines}` : null;
          const parts = [shardPrefix, countText, lineText, rel].filter(Boolean);
          logLine(parts.join(' '));
        }
        crashLogger.updateFile({
          phase: 'processing',
          mode,
          fileIndex,
          total: progress.total,
          file: entry.rel,
          size: entry.stat?.size || null
        });
        try {
          const result = await processFile(entry, fileIndex);
          progress.tick();
          return result;
        } catch (err) {
          crashLogger.logError({
            phase: 'processing',
            mode,
            file: entry.rel,
            message: err?.message || String(err),
            stack: err?.stack || null
          });
          throw err;
        }
      },
      {
        collectResults: false,
        onResult: (result) => handleFileResult(result, stateRef, shardMeta),
        retries: 2,
        retryDelayMs: 200
      }
    );
  };
  const discoveryLineCounts = discovery?.lineCounts instanceof Map ? discovery.lineCounts : null;
  let lineCounts = discoveryLineCounts;
  if (runtime.shards?.enabled && !lineCounts) {
    const hasEntryLines = allEntries.some((entry) => Number.isFinite(entry?.lines) && entry.lines > 0);
    if (!hasEntryLines) {
      const lineStart = Date.now();
      const lineConcurrency = Math.max(1, Math.min(32, runtime.cpuConcurrency * 2));
      if (envConfig.verbose === true) {
        log(`→ Shard planning: counting lines (${lineConcurrency} workers)...`);
      }
      lineCounts = await countLinesForEntries(allEntries, { concurrency: lineConcurrency });
      timing.lineCountsMs = Date.now() - lineStart;
    }
  }
  const shardFeatureWeights = {
    relations: relationsEnabled ? 0.15 : 0,
    flow: (runtime.astDataflowEnabled || runtime.controlFlowEnabled) ? 0.1 : 0,
    treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false ? 0.1 : 0,
    tooling: runtime.toolingEnabled ? 0.1 : 0,
    embeddings: runtime.embeddingEnabled ? 0.2 : 0
  };
  const shardPlan = runtime.shards?.enabled
    ? planShards(allEntries, {
      mode,
      maxShards: runtime.shards.maxShards,
      minFiles: runtime.shards.minFiles,
      dirDepth: runtime.shards.dirDepth,
      lineCounts,
      perfProfile: shardPerfProfile,
      featureWeights: shardFeatureWeights,
      maxShardBytes: runtime.shards.maxShardBytes,
      maxShardLines: runtime.shards.maxShardLines
    })
    : null;
  const shardSummary = shardPlan
    ? shardPlan.map((shard) => ({
      id: shard.id,
      label: shard.label || shard.id,
      dir: shard.dir,
      lang: shard.lang,
      fileCount: shard.entries.length,
      lineCount: shard.lineCount || 0,
      byteCount: shard.byteCount || 0,
      costMs: shard.costMs || 0
    }))
    : [];
  if (incrementalState?.manifest) {
    const updatedAt = new Date().toISOString();
    incrementalState.manifest.shards = runtime.shards?.enabled
      ? { enabled: true, updatedAt, plan: shardSummary }
      : { enabled: false, updatedAt };
  }
  if (shardPlan && shardPlan.length > 1) {
    const shardExecutionPlan = [...shardPlan].sort((a, b) => {
      const costDelta = (b.costMs || 0) - (a.costMs || 0);
      if (costDelta !== 0) return costDelta;
      const lineDelta = (b.lineCount || 0) - (a.lineCount || 0);
      if (lineDelta !== 0) return lineDelta;
      const sizeDelta = b.entries.length - a.entries.length;
      if (sizeDelta !== 0) return sizeDelta;
      return (a.label || a.id).localeCompare(b.label || b.id);
    });
    const shardIndexById = new Map(
      shardExecutionPlan.map((shard, index) => [shard.id, index + 1])
    );
    const totalFiles = shardPlan.reduce((sum, shard) => sum + shard.entries.length, 0);
    const totalLines = shardPlan.reduce((sum, shard) => sum + (shard.lineCount || 0), 0);
    const totalBytes = shardPlan.reduce((sum, shard) => sum + (shard.byteCount || 0), 0);
    const totalCost = shardPlan.reduce((sum, shard) => sum + (shard.costMs || 0), 0);
    if (envConfig.verbose === true) {
      const top = shardExecutionPlan.slice(0, Math.min(10, shardExecutionPlan.length));
      const costLabel = totalCost ? `, est ${Math.round(totalCost).toLocaleString()}ms` : '';
      log(`→ Shard plan: ${shardPlan.length} shards, ${totalFiles.toLocaleString()} files, ${totalLines.toLocaleString()} lines${costLabel}.`);
      for (const shard of top) {
        const lineCount = shard.lineCount || 0;
        const byteCount = shard.byteCount || 0;
        const costMs = shard.costMs || 0;
        const costText = costMs ? ` | est ${Math.round(costMs).toLocaleString()}ms` : '';
        log(`[shards] ${shard.label || shard.id} | files ${shard.entries.length.toLocaleString()} | lines ${lineCount.toLocaleString()} | bytes ${byteCount.toLocaleString()}${costText}`);
      }
      const splitGroups = new Map();
      for (const shard of shardPlan) {
        if (!shard.splitFrom) continue;
        const group = splitGroups.get(shard.splitFrom) || { count: 0, lines: 0, bytes: 0, cost: 0 };
        group.count += 1;
        group.lines += shard.lineCount || 0;
        group.bytes += shard.byteCount || 0;
        group.cost += shard.costMs || 0;
        splitGroups.set(shard.splitFrom, group);
      }
      for (const [label, group] of splitGroups) {
        const costText = group.cost ? `, est ${Math.round(group.cost).toLocaleString()}ms` : '';
        log(`[shards] split ${label} -> ${group.count} parts (${group.lines.toLocaleString()} lines, ${group.bytes.toLocaleString()} bytes${costText})`);
      }
    }
    const buildShardWorkPlan = () => {
      const work = [];
      const totalShards = shardExecutionPlan.length;
      for (const shard of shardExecutionPlan) {
        const fileCount = shard.entries.length;
        const costPerFile = shard.costMs && fileCount ? shard.costMs / fileCount : 0;
        const fileShare = totalFiles > 0 ? fileCount / totalFiles : 0;
        const lineCount = shard.lineCount || 0;
        const lineShare = totalLines > 0 ? lineCount / totalLines : 0;
        const byteCount = shard.byteCount || 0;
        const byteShare = totalBytes > 0 ? byteCount / totalBytes : 0;
        const costMs = shard.costMs || 0;
        const costShare = totalCost > 0 ? costMs / totalCost : 0;
        const share = Math.max(fileShare, lineShare, byteShare, costShare);
        let parts = 1;
        if (share > 0.05) parts = share > 0.1 ? 4 : 2;
        parts = Math.min(parts, Math.max(1, fileCount));
        if (parts <= 1) {
          work.push({
            shard,
            entries: shard.entries,
            partIndex: 1,
            partTotal: 1,
            predictedCostMs: costPerFile ? costPerFile * fileCount : costMs,
            shardIndex: shardIndexById.get(shard.id) || 1,
            shardTotal: totalShards
          });
          continue;
        }
        const perPart = Math.ceil(fileCount / parts);
        for (let i = 0; i < parts; i += 1) {
          const start = i * perPart;
          const end = Math.min(start + perPart, fileCount);
          if (start >= end) continue;
          const partCount = end - start;
          work.push({
            shard,
            entries: shard.entries.slice(start, end),
            partIndex: i + 1,
            partTotal: parts,
            predictedCostMs: costPerFile ? costPerFile * partCount : costMs / parts,
            shardIndex: shardIndexById.get(shard.id) || 1,
            shardTotal: totalShards
          });
        }
      }
      return work;
    };
    const shardWorkPlan = buildShardWorkPlan();
    let defaultShardConcurrency = Math.max(1, Math.min(4, runtime.fileConcurrency));
    if (process.platform === 'win32') {
      defaultShardConcurrency = Math.max(1, runtime.cpuConcurrency);
    }
    let shardConcurrency = Number.isFinite(runtime.shards.maxWorkers)
      ? Math.max(1, Math.floor(runtime.shards.maxWorkers))
      : defaultShardConcurrency;
    shardConcurrency = Math.min(shardConcurrency, runtime.fileConcurrency);
    const perShardFileConcurrency = Math.max(
      1,
      Math.min(2, Math.floor(runtime.fileConcurrency / shardConcurrency))
    );
    const perShardImportConcurrency = Math.max(1, Math.floor(runtime.importConcurrency / shardConcurrency));
    const baseEmbedConcurrency = Number.isFinite(runtime.embeddingConcurrency)
      ? runtime.embeddingConcurrency
      : runtime.cpuConcurrency;
    const perShardEmbeddingConcurrency = Math.max(
      1,
      Math.min(perShardFileConcurrency, Math.floor(baseEmbedConcurrency / shardConcurrency))
    );
    log(`→ Sharding enabled: ${shardPlan.length} shards (concurrency=${shardConcurrency}, per-shard files=${perShardFileConcurrency}).`);
    const workQueue = shardWorkPlan.slice();
    const langScale = new Map();
    const getEffectiveCost = (workItem) => {
      const base = Number.isFinite(workItem.predictedCostMs)
        ? workItem.predictedCostMs
        : (workItem.shard.costMs || workItem.shard.lineCount || workItem.entries.length || 0);
      const scale = langScale.get(workItem.shard.lang) || 1;
      return base * scale;
    };
    const pickNextWork = () => {
      if (!workQueue.length) return null;
      workQueue.sort((a, b) => getEffectiveCost(b) - getEffectiveCost(a));
      return workQueue.shift();
    };
    const updateLangScale = (workItem, actualMs) => {
      if (!Number.isFinite(actualMs) || actualMs <= 0) return;
      const predicted = Number.isFinite(workItem.predictedCostMs)
        ? workItem.predictedCostMs
        : 0;
      if (!predicted) return;
      const ratio = actualMs / predicted;
      const prev = langScale.get(workItem.shard.lang) || 1;
      const next = prev * 0.7 + ratio * 0.3;
      langScale.set(workItem.shard.lang, next);
    };
    const runShardWorker = async () => {
      while (true) {
        const workItem = pickNextWork();
        if (!workItem) break;
        const {
          shard,
          entries,
          partIndex,
          partTotal,
          shardIndex,
          shardTotal
        } = workItem;
        const shardRuntime = createShardRuntime(runtime, {
          fileConcurrency: perShardFileConcurrency,
          importConcurrency: perShardImportConcurrency,
          embeddingConcurrency: perShardEmbeddingConcurrency
        });
        const shardLabel = shard.label || shard.id;
        let shardBracket = shardLabel === shard.id ? null : shard.id;
        if (partTotal > 1) {
          const partLabel = `part ${partIndex}/${partTotal}`;
          shardBracket = shardBracket ? `${shardBracket} ${partLabel}` : partLabel;
        }
        const shardDisplay = shardLabel + (shardBracket ? ` [${shardBracket}]` : '');
        log(`→ Shard ${shardIndex}/${shardTotal}: ${shardDisplay} (${entries.length} files)`);
        const shardState = createIndexState();
        const shardStart = Date.now();
        await processEntries({
          entries,
          runtime: shardRuntime,
          shardMeta: shard,
          stateRef: shardState
        });
        const shardDurationMs = Date.now() - shardStart;
        updateLangScale(workItem, shardDurationMs);
        mergeIndexState(state, shardState);
      }
    };
    await Promise.all(
      Array.from({ length: shardConcurrency }, () => runShardWorker())
    );
  } else {
    await processEntries({ entries: allEntries, runtime, stateRef: state });
  }
  showProgress('Files', progress.total, progress.total);
  checkpoint.finish();

  if (mode === 'code' && relationsEnabled && enableImportLinks && !usePreScan) {
    const importStart = Date.now();
    const importLinks = buildImportLinksFromRelations(state.fileRelations);
    importResult = {
      allImports: importLinks.allImports || {},
      stats: importLinks.stats || null,
      durationMs: Date.now() - importStart
    };
    timing.importsMs = importResult.durationMs;
    if (importResult?.stats) {
      const { modules, edges, files } = importResult.stats;
      log(`→ Imports: modules=${modules}, edges=${edges}, files=${files}`);
    }
  }

  timing.processMs = Date.now() - processStart;
  if (envConfig.verbose === true && tokenizationStats.chunks) {
    const avgTokens = (tokenizationStats.tokens / tokenizationStats.chunks).toFixed(1);
    const avgChargrams = (tokenizationStats.chargrams / tokenizationStats.chunks).toFixed(1);
    log(`[tokenization] ${mode}: chunks=${tokenizationStats.chunks}, tokens=${tokenizationStats.tokens}, avgTokens=${avgTokens}, avgChargrams=${avgChargrams}`);
  }

  await pruneIncrementalManifest({
    enabled: runtime.incrementalEnabled,
    manifest: incrementalState.manifest,
    manifestPath: incrementalState.manifestPath,
    bundleDir: incrementalState.bundleDir,
    seenFiles
  });

  log(`   → Indexed ${state.chunks.length} chunks, total tokens: ${state.totalTokens.toLocaleString()}`);

  const postings = await buildPostings({
    chunks: state.chunks,
    df: state.df,
    tokenPostings: state.tokenPostings,
    docLengths: state.docLengths,
    fieldPostings: state.fieldPostings,
    fieldDocLengths: state.fieldDocLengths,
    phrasePost: state.phrasePost,
    triPost: state.triPost,
    postingsConfig: runtime.postingsConfig,
    modelId: runtime.modelId,
    useStubEmbeddings: runtime.useStubEmbeddings,
    log,
    workerPool: runtime.workerPool,
    quantizePool: runtime.quantizePool,
    embeddingsEnabled: runtime.embeddingEnabled
  });

  const crossFileEnabled = runtime.typeInferenceCrossFileEnabled || runtime.riskAnalysisCrossFileEnabled;
  if (mode === 'code' && crossFileEnabled) {
    crashLogger.updatePhase('cross-file');
    const crossFileStats = await applyCrossFileInference({
      rootDir: runtime.root,
      chunks: state.chunks,
      enabled: true,
      log,
      useTooling: runtime.typeInferenceEnabled && runtime.typeInferenceCrossFileEnabled && runtime.toolingEnabled,
      enableTypeInference: runtime.typeInferenceEnabled,
      enableRiskCorrelation: runtime.riskAnalysisEnabled && runtime.riskAnalysisCrossFileEnabled,
      fileRelations: state.fileRelations
    });
    if (crossFileStats) {
      const riskFlows = Number.isFinite(crossFileStats.riskFlows) ? crossFileStats.riskFlows : 0;
      log(`Cross-file inference: callLinks=${crossFileStats.linkedCalls}, usageLinks=${crossFileStats.linkedUsages}, returns=${crossFileStats.inferredReturns}, riskFlows=${riskFlows}`);
    }
    await updateBundlesWithChunks({
      enabled: runtime.incrementalEnabled,
      manifest: incrementalState.manifest,
      bundleDir: incrementalState.bundleDir,
      chunks: state.chunks,
      fileRelations: state.fileRelations,
      log
    });
  }

  const finalizedPerfProfile = finalizePerfProfile(perfProfile);
  await writeIndexArtifacts({
    outDir,
    mode,
    state,
    postings,
    postingsConfig: runtime.postingsConfig,
    modelId: runtime.modelId,
    useStubEmbeddings: runtime.useStubEmbeddings,
    dictSummary: runtime.dictSummary,
    timing,
    root: runtime.root,
    userConfig: runtime.userConfig,
    incrementalEnabled: runtime.incrementalEnabled,
    fileCounts: { candidates: allEntries.length },
    perfProfile: finalizedPerfProfile,
    indexState: {
      generatedAt: new Date().toISOString(),
      mode,
      stage: runtime.stage || null,
      embeddings: {
        enabled: runtime.embeddingEnabled || runtime.embeddingService,
        ready: runtime.embeddingEnabled,
        mode: runtime.embeddingMode,
        service: runtime.embeddingService === true
      },
      features: {
        treeSitter: runtime.languageOptions?.treeSitter?.enabled !== false,
        lint: runtime.lintEnabled,
        complexity: runtime.complexityEnabled,
        riskAnalysis: runtime.riskAnalysisEnabled,
        riskAnalysisCrossFile: runtime.riskAnalysisCrossFileEnabled,
        typeInference: runtime.typeInferenceEnabled,
        typeInferenceCrossFile: runtime.typeInferenceCrossFileEnabled,
        gitBlame: runtime.gitBlameEnabled
      },
      shards: runtime.shards?.enabled
        ? { enabled: true, plan: shardSummary }
        : { enabled: false },
      enrichment: runtime.twoStage?.enabled
        ? {
          enabled: true,
          pending: runtime.stage === 'stage1',
          stage: runtime.stage || null
        }
        : { enabled: false }
    }
  });
  await enqueueEmbeddingJob({ runtime, mode });
  crashLogger.updatePhase('done');
  cacheReporter.report();
}

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyAdaptiveDictConfig, getCacheRoot, getIndexDir } from '../../../tools/dict-utils.js';
import { buildRecordsIndexForRepo } from '../../integrations/triage/index-records.js';
import { applyCrossFileInference } from '../type-inference-crossfile.js';
import { createTaskQueues, runWithConcurrency, runWithQueue } from '../../shared/concurrency.js';
import { createCacheReporter } from '../../shared/cache.js';
import { log, logLine, showProgress } from '../../shared/progress.js';
import { toPosix } from '../../shared/files.js';
import { writeIndexArtifacts } from './artifacts.js';
import { estimateContextWindow } from './context-window.js';
import { discoverFiles } from './discover.js';
import { createCrashLogger } from './crash-log.js';
import { createFileProcessor } from './file-processor.js';
import { scanImports } from './imports.js';
import { loadIncrementalState, pruneIncrementalManifest, updateBundlesWithChunks } from './incremental.js';
import { buildPostings } from './postings.js';
import { createIndexState, appendChunk, mergeIndexState } from './state.js';
import { configureGitMetaCache } from '../git.js';
import { loadStructuralMatches } from '../structural.js';
import { sha1 } from '../../shared/hash.js';
import { planShards } from './shards.js';
import { ensureQueueDir, enqueueJob } from '../../../tools/service/queue.js';

const buildTokenizationKey = (runtime, mode) => {
  const payload = {
    mode,
    dictConfig: runtime.dictConfig || {},
    postingsConfig: runtime.postingsConfig || {},
    dictSignature: runtime.dictSignature || null
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
 * @param {{mode:'code'|'prose'|'records',runtime:object,discovery?:{entries:Array,skippedFiles:Array}}} input
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
  const outDir = getIndexDir(runtime.root, mode, runtime.userConfig);
  await fs.mkdir(outDir, { recursive: true });
  log(`\n📄  Scanning ${mode} …`);
  const timing = { start: Date.now() };
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
  const incrementalState = await loadIncrementalState({
    repoCacheRoot: runtime.repoCacheRoot,
    mode,
    enabled: runtime.incrementalEnabled,
    tokenizationKey,
    log
  });
  configureGitMetaCache(runtime.cacheConfig?.gitMeta, cacheReporter);

  let importResult = { allImports: {}, durationMs: 0 };
  if (mode === 'code') {
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
  const showFileProgress = process.env.PAIROFCLEATS_PROGRESS_FILES === '1';

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
  const progress = {
    total: allEntries.length,
    count: 0,
    tick() {
      this.count += 1;
      showProgress('Files', this.count, this.total);
    }
  };
  const handleFileResult = (result, stateRef, shardMeta = null) => {
    if (!result) return;
    for (const chunk of result.chunks) {
      appendChunk(stateRef, { ...chunk }, runtime.postingsConfig);
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
    const queues = createTaskQueues({ ioConcurrency, cpuConcurrency, embeddingConcurrency });
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
      allImports: importResult.allImports,
      contextWin,
      incrementalState,
      getChunkEmbedding: runtimeRef.getChunkEmbedding,
      getChunkEmbeddings: runtimeRef.getChunkEmbeddings,
      embeddingBatchSize: runtimeRef.embeddingBatchSize,
      embeddingEnabled: runtimeRef.embeddingEnabled,
      typeInferenceEnabled: runtimeRef.typeInferenceEnabled,
      riskAnalysisEnabled: runtimeRef.riskAnalysisEnabled,
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
          const prefix = shardLabel ? `[${shardLabel}] ` : '';
          logLine(`${prefix}File ${progress.count + 1}/${progress.total} ${rel}`);
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
  const shardPlan = runtime.shards?.enabled
    ? planShards(allEntries, {
      mode,
      maxShards: runtime.shards.maxShards,
      minFiles: runtime.shards.minFiles,
      dirDepth: runtime.shards.dirDepth
    })
    : null;
  const shardSummary = shardPlan
    ? shardPlan.map((shard) => ({
      id: shard.id,
      label: shard.label || shard.id,
      dir: shard.dir,
      lang: shard.lang,
      fileCount: shard.entries.length
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
      const sizeDelta = b.entries.length - a.entries.length;
      if (sizeDelta !== 0) return sizeDelta;
      return (a.label || a.id).localeCompare(b.label || b.id);
    });
    const shardIndexById = new Map(
      shardExecutionPlan.map((shard, index) => [shard.id, index + 1])
    );
    const totalFiles = shardPlan.reduce((sum, shard) => sum + shard.entries.length, 0);
    const shardLineCounts = new Map();
    let totalLines = 0;
    for (const shard of shardPlan) {
      let shardLines = 0;
      for (const entry of shard.entries) {
        const lineCount = Number(entry?.lines ?? entry?.lineCount ?? entry?.stat?.lines);
        if (Number.isFinite(lineCount) && lineCount > 0) shardLines += lineCount;
      }
      if (shardLines > 0) {
        shardLineCounts.set(shard.id, shardLines);
        totalLines += shardLines;
      }
    }
    const buildShardWorkPlan = () => {
      const work = [];
      const totalShards = shardExecutionPlan.length;
      for (const shard of shardExecutionPlan) {
        const fileCount = shard.entries.length;
        const fileShare = totalFiles > 0 ? fileCount / totalFiles : 0;
        const lineCount = shardLineCounts.get(shard.id) || 0;
        const lineShare = totalLines > 0 ? lineCount / totalLines : 0;
        const share = Math.max(fileShare, lineShare);
        let parts = 1;
        if (share > 0.05) parts = share > 0.1 ? 4 : 2;
        parts = Math.min(parts, Math.max(1, fileCount));
        if (parts <= 1) {
          work.push({
            shard,
            entries: shard.entries,
            partIndex: 1,
            partTotal: 1,
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
          work.push({
            shard,
            entries: shard.entries.slice(start, end),
            partIndex: i + 1,
            partTotal: parts,
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
    await runWithConcurrency(
      shardWorkPlan,
      shardConcurrency,
      async (workItem) => {
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
        await processEntries({
          entries,
          runtime: shardRuntime,
          shardMeta: shard,
          stateRef: shardState
        });
        mergeIndexState(state, shardState);
      },
      { collectResults: false }
    );
  } else {
    await processEntries({ entries: allEntries, runtime, stateRef: state });
  }
  showProgress('Files', progress.total, progress.total);

  timing.processMs = Date.now() - processStart;
  if (process.env.PAIROFCLEATS_VERBOSE === '1' && tokenizationStats.chunks) {
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

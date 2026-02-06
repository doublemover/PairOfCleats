import path from 'node:path';
import { runWithQueue } from '../../../../shared/concurrency.js';
import { getEnvConfig } from '../../../../shared/env.js';
import { fileExt, toPosix } from '../../../../shared/files.js';
import { countLinesForEntries } from '../../../../shared/file-stats.js';
import { log, logLine, showProgress } from '../../../../shared/progress.js';
import { throwIfAborted } from '../../../../shared/abort.js';
import { compareStrings } from '../../../../shared/sort.js';
import { treeSitterState } from '../../../../lang/tree-sitter/state.js';
import { createBuildCheckpoint } from '../../build-state.js';
import { createFileProcessor } from '../../file-processor.js';
import { loadStructuralMatches } from '../../../structural.js';
import { planShardBatches, planShards } from '../../shards.js';
import { recordFileMetric } from '../../perf-profile.js';
import { createVfsManifestCollector } from '../../vfs-manifest-collector.js';
import { createTokenRetentionState } from './postings.js';
import { createPostingsQueue, estimatePostingsPayload } from './process-files/postings-queue.js';
import { buildOrderedAppender } from './process-files/ordered.js';
import {
  applyTreeSitterBatching,
  buildTreeSitterEntryBatches,
  assignFileIndexes,
  normalizeTreeSitterLanguages,
  preloadTreeSitterBatch,
  resolveTreeSitterPreloadPlan,
  resolveNextOrderIndex,
  sortEntriesByTreeSitterBatchKey,
  updateEntryTreeSitterBatch
} from './process-files/tree-sitter.js';
import {
  preloadTreeSitterLanguages,
  preflightTreeSitterWasmLanguages
} from '../../../../lang/tree-sitter.js';
import { createShardRuntime, resolveCheckpointBatchSize } from './process-files/runtime.js';
import { SCHEDULER_QUEUE_NAMES } from '../../runtime/scheduler.js';

const FILE_WATCHDOG_MS = 10000;
const DEFAULT_POSTINGS_ROWS_PER_PENDING = 200;
const DEFAULT_POSTINGS_BYTES_PER_PENDING = 8 * 1024 * 1024;

const coercePositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

const bumpTreeSitterMetric = (key, amount = 1) => {
  if (!key) return;
  const metrics = treeSitterState.metrics;
  if (!metrics || typeof metrics !== 'object') return;
  const current = Number.isFinite(metrics[key]) ? metrics[key] : 0;
  metrics[key] = current + amount;
};

const setTreeSitterMetricMax = (key, value) => {
  if (!key) return;
  const metrics = treeSitterState.metrics;
  if (!metrics || typeof metrics !== 'object') return;
  const current = Number.isFinite(metrics[key]) ? metrics[key] : 0;
  const next = Number.isFinite(value) ? value : null;
  if (next == null) return;
  metrics[key] = Math.max(current, next);
};

const resolvePostingsQueueConfig = (runtime) => {
  const config = runtime?.stage1Queues?.postings || {};
  const cpuPending = Number.isFinite(runtime?.queues?.cpu?.maxPending)
    ? runtime.queues.cpu.maxPending
    : null;
  const cpuConcurrency = Number.isFinite(runtime?.cpuConcurrency)
    ? Math.max(1, Math.floor(runtime.cpuConcurrency))
    : 1;
  const baseMaxPending = coercePositiveInt(config.maxPending)
    ?? cpuPending
    ?? Math.max(16, cpuConcurrency * 4);
  const maxPendingRows = coercePositiveInt(config.maxPendingRows)
    ?? Math.max(DEFAULT_POSTINGS_ROWS_PER_PENDING, baseMaxPending * DEFAULT_POSTINGS_ROWS_PER_PENDING);
  const maxPendingBytes = coercePositiveInt(config.maxPendingBytes)
    ?? Math.max(DEFAULT_POSTINGS_BYTES_PER_PENDING, baseMaxPending * DEFAULT_POSTINGS_BYTES_PER_PENDING);
  const maxHeapFraction = Number(config.maxHeapFraction);
  return {
    maxPending: baseMaxPending,
    maxPendingRows,
    maxPendingBytes,
    maxHeapFraction: Number.isFinite(maxHeapFraction) && maxHeapFraction > 0 ? maxHeapFraction : undefined
  };
};

export const processFiles = async ({
  mode,
  runtime,
  discovery,
  entries,
  contextWin,
  timing,
  crashLogger,
  state,
  perfProfile,
  cacheReporter,
  seenFiles,
  incrementalState,
  relationsEnabled,
  shardPerfProfile,
  fileTextCache,
  abortSignal = null
}) => {
  throwIfAborted(abortSignal);
  log('Processing and indexing files...');
  crashLogger.updatePhase('processing');
  const processStart = Date.now();
  const ioQueueConcurrency = Number.isFinite(runtime?.queues?.io?.concurrency)
    ? runtime.queues.io.concurrency
    : runtime.ioConcurrency;
  const cpuQueueConcurrency = Number.isFinite(runtime?.queues?.cpu?.concurrency)
    ? runtime.queues.cpu.concurrency
    : runtime.cpuConcurrency;
  log(
    `Indexing Concurrency: Files: ${runtime.fileConcurrency}, ` +
    `Imports: ${runtime.importConcurrency}, IO: ${ioQueueConcurrency}, CPU: ${cpuQueueConcurrency}`
  );
  const envConfig = getEnvConfig();
  const showFileProgress = envConfig.verbose === true || runtime?.argv?.verbose === true;
  const debugOrdered = envConfig.debugOrdered === true;

  const structuralMatches = await loadStructuralMatches({
    repoRoot: runtime.root,
    repoCacheRoot: runtime.repoCacheRoot,
    log
  });
  const tokenRetentionState = createTokenRetentionState({
    runtime,
    totalFiles: entries.length,
    log
  });
  const { tokenizationStats, appendChunkWithRetention } = tokenRetentionState;
  const postingsQueueConfig = resolvePostingsQueueConfig(runtime);
  const postingsQueue = createPostingsQueue({
    ...postingsQueueConfig,
    log
  });
  if (runtime?.scheduler?.registerQueue) {
    runtime.scheduler.registerQueue(SCHEDULER_QUEUE_NAMES.stage1Postings, {
      ...(Number.isFinite(postingsQueueConfig.maxPending)
        ? { maxPending: postingsQueueConfig.maxPending }
        : {})
    });
  }
  const schedulePostings = runtime?.scheduler?.schedule
    // Avoid deadlocking the scheduler when Stage1 CPU work is already holding
    // the only CPU token (e.g. --threads 1). Postings apply runs on the same
    // JS thread, so account it against memory/backpressure only.
    ? (fn) => runtime.scheduler.schedule(SCHEDULER_QUEUE_NAMES.stage1Postings, { mem: 1 }, fn)
    : (fn) => fn();
  let checkpoint = null;
  let progress = null;
  applyTreeSitterBatching(entries, runtime.languageOptions?.treeSitter, envConfig, {
    // Avoid reordering: ordered appender waits on canonical order, and
    // out-of-order processing can deadlock queue completion.
    allowReorder: false
  });
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (Number.isFinite(entry.processingOrderIndex)) {
      entry.orderIndex = entry.processingOrderIndex;
    }
  }
  const startOrderIndex = (() => {
    let minIndex = null;
    for (const entry of entries || []) {
      if (!entry || typeof entry !== 'object') continue;
      const value = Number.isFinite(entry.orderIndex)
        ? entry.orderIndex
        : (Number.isFinite(entry.canonicalOrderIndex) ? entry.canonicalOrderIndex : null);
      if (!Number.isFinite(value)) continue;
      minIndex = minIndex == null ? value : Math.min(minIndex, value);
    }
    return Number.isFinite(minIndex) ? Math.max(0, Math.floor(minIndex)) : 0;
  })();
  const applyFileResult = async (result, stateRef, shardMeta) => {
    if (!result) return;
    if (result.fileMetrics) {
      recordFileMetric(perfProfile, result.fileMetrics);
    }
    for (const chunk of result.chunks) {
      appendChunkWithRetention(stateRef, chunk, state);
    }
    stateRef.scannedFilesTimes.push({ file: result.abs, duration_ms: result.durationMs, cached: result.cached });
    stateRef.scannedFiles.push(result.abs);
    if (result.manifestEntry) {
      if (shardMeta?.id) result.manifestEntry.shard = shardMeta.id;
      incrementalState.manifest.files[result.relKey] = result.manifestEntry;
    }
    if (result.fileInfo && result.relKey) {
      if (!stateRef.fileInfoByPath) stateRef.fileInfoByPath = new Map();
      stateRef.fileInfoByPath.set(result.relKey, result.fileInfo);
    }
    if (result.relKey && Array.isArray(result.chunks) && result.chunks.length) {
      if (!stateRef.fileDetailsByPath) stateRef.fileDetailsByPath = new Map();
      if (!stateRef.fileDetailsByPath.has(result.relKey)) {
        const first = result.chunks[0] || {};
        const info = result.fileInfo || {};
        stateRef.fileDetailsByPath.set(result.relKey, {
          file: result.relKey,
          ext: first.ext || fileExt(result.relKey),
          size: Number.isFinite(info.size) ? info.size : (Number.isFinite(first.fileSize) ? first.fileSize : null),
          hash: info.hash || first.fileHash || null,
          hashAlgo: info.hashAlgo || first.fileHashAlgo || null,
          externalDocs: first.externalDocs || null,
          last_modified: first.last_modified || null,
          last_author: first.last_author || null,
          churn: first.churn || null,
          churn_added: first.churn_added || null,
          churn_deleted: first.churn_deleted || null,
          churn_commits: first.churn_commits || null
        });
      }
    }
    if (Array.isArray(result.chunks) && result.chunks.length) {
      if (!stateRef.chunkUidToFile) stateRef.chunkUidToFile = new Map();
      for (const chunk of result.chunks) {
        const chunkUid = chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;
        if (!chunkUid || stateRef.chunkUidToFile.has(chunkUid)) continue;
        stateRef.chunkUidToFile.set(chunkUid, result.relKey);
      }
    }
    if (result.fileRelations) {
      stateRef.fileRelations.set(result.relKey, result.fileRelations);
    }
    if (Array.isArray(result.vfsManifestRows) && result.vfsManifestRows.length) {
      if (!stateRef.vfsManifestCollector) {
        stateRef.vfsManifestCollector = createVfsManifestCollector({
          buildRoot: runtime.buildRoot || runtime.root,
          log
        });
        stateRef.vfsManifestRows = null;
        stateRef.vfsManifestStats = stateRef.vfsManifestCollector.stats;
      }
      await stateRef.vfsManifestCollector.appendRows(result.vfsManifestRows, { log });
    }
  };
  const orderedAppender = buildOrderedAppender(
    (result, stateRef, shardMeta) => schedulePostings(() => applyFileResult(result, stateRef, shardMeta)),
    state,
    {
      expectedCount: Array.isArray(entries) ? entries.length : null,
      startIndex: startOrderIndex,
      log: (message, meta = {}) => logLine(message, { ...meta, mode, stage: 'processing' }),
      stallMs: debugOrdered ? 5000 : undefined,
      debugOrdered
    }
  );
  const treeSitterOptions = runtime.languageOptions?.treeSitter || null;
  if (treeSitterOptions?.enabled !== false && treeSitterOptions?.preload !== 'none') {
    const preloadPlan = resolveTreeSitterPreloadPlan(entries, treeSitterOptions);
    if (preloadPlan.languages.length) {
      await preflightTreeSitterWasmLanguages(preloadPlan.languages, { log });
      await preloadTreeSitterLanguages(preloadPlan.languages, {
        log,
        parallel: treeSitterOptions.preload === 'parallel',
        concurrency: treeSitterOptions.preloadConcurrency,
        maxLoadedLanguages: treeSitterOptions.maxLoadedLanguages
      });
    }
  }
  assignFileIndexes(entries);
  const orderIndexState = { next: resolveNextOrderIndex(entries) };
  const processEntries = async ({ entries: shardEntries, runtime: runtimeRef, shardMeta = null, stateRef }) => {
    const shardLabel = shardMeta?.label || shardMeta?.id || null;
    const shardProgress = shardMeta
      ? {
        total: shardEntries.length,
        count: 0,
        meta: {
          taskId: `shard:${shardMeta.id}:${shardMeta.partIndex || 1}`,
          stage: 'processing',
          mode,
          shardId: shardMeta.id,
          shardIndex: shardMeta.shardIndex || null,
          shardTotal: shardMeta.shardTotal || null,
          message: shardMeta.display || shardLabel || shardMeta.id,
          ephemeral: true
        }
      }
      : null;
    const { processFile } = createFileProcessor({
      root: runtimeRef.root,
      mode,
      fileTextCache,
      dictConfig: runtimeRef.dictConfig,
      dictWords: runtimeRef.dictWords,
      dictShared: runtimeRef.dictShared,
      codeDictWords: runtimeRef.codeDictWords,
      codeDictWordsByLanguage: runtimeRef.codeDictWordsByLanguage,
      codeDictLanguages: runtimeRef.codeDictLanguages,
      scmProvider: runtimeRef.scmProvider,
      scmProviderImpl: runtimeRef.scmProviderImpl,
      scmRepoRoot: runtimeRef.scmRepoRoot,
      scmConfig: runtimeRef.scmConfig,
      languageOptions: runtimeRef.languageOptions,
      postingsConfig: runtimeRef.postingsConfig,
      segmentsConfig: runtimeRef.segmentsConfig,
      commentsConfig: runtimeRef.commentsConfig,
      contextWin,
      incrementalState,
      getChunkEmbedding: runtimeRef.getChunkEmbedding,
      getChunkEmbeddings: runtimeRef.getChunkEmbeddings,
      embeddingBatchSize: runtimeRef.embeddingBatchSize,
      embeddingEnabled: runtimeRef.embeddingEnabled,
      embeddingNormalize: runtimeRef.embeddingNormalize,
      analysisPolicy: runtimeRef.analysisPolicy,
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
      maxFileBytes: runtimeRef.maxFileBytes,
      fileScan: runtimeRef.fileScan,
      featureMetrics: runtimeRef.featureMetrics,
      buildStage: runtimeRef.stage
    });
    const runEntryBatch = async (batchEntries, deferredEntries) => {
      await runWithQueue(
        runtimeRef.queues.cpu,
        batchEntries,
        async (entry, ctx) => {
          const queueIndex = Number.isFinite(ctx?.index) ? ctx.index : null;
          const stableFileIndex = Number.isFinite(entry?.fileIndex)
            ? entry.fileIndex
            : (Number.isFinite(queueIndex) ? queueIndex + 1 : null);
          const rel = entry.rel || toPosix(path.relative(runtimeRef.root, entry.abs));
          const watchdogStart = Date.now();
          let watchdog = null;
          if (FILE_WATCHDOG_MS > 0) {
            watchdog = setTimeout(() => {
              const elapsedMs = Date.now() - watchdogStart;
              const lineText = Number.isFinite(entry.lines) ? ` lines ${entry.lines}` : '';
              logLine(`[watchdog] slow file ${stableFileIndex ?? '?'} ${rel} (${elapsedMs}ms)${lineText}`, {
                kind: 'file-watchdog',
                mode,
                stage: 'processing',
                file: rel,
                fileIndex: stableFileIndex,
                total: progress.total,
                lines: entry.lines || null,
                durationMs: elapsedMs
              });
            }, FILE_WATCHDOG_MS);
            watchdog.unref?.();
          }
          if (showFileProgress) {
            const shardText = shardLabel ? `shard ${shardLabel}` : 'shard';
            const shardPrefix = `[${shardText}]`;
            const countText = `${stableFileIndex ?? '?'}/${progress.total}`;
            const lineText = Number.isFinite(entry.lines) ? `lines ${entry.lines}` : null;
            const parts = [shardPrefix, countText, lineText, rel].filter(Boolean);
            logLine(parts.join(' '), {
              kind: 'file-progress',
              mode,
              stage: 'processing',
              shardId: shardMeta?.id || null,
              file: rel,
              fileIndex: stableFileIndex,
              total: progress.total,
              lines: entry.lines || null
            });
          }
          crashLogger.updateFile({
            phase: 'processing',
            mode,
            stage: runtimeRef.stage,
            fileIndex: stableFileIndex,
            total: progress.total,
            file: entry.rel,
            size: entry.stat?.size || null,
            shardId: shardMeta?.id || null
          });
          try {
            return await processFile(entry, stableFileIndex);
          } catch (err) {
            crashLogger.logError({
              phase: 'processing',
              mode,
              stage: runtimeRef.stage,
              fileIndex: stableFileIndex,
              total: progress.total,
              file: entry.rel,
              size: entry.stat?.size || null,
              shardId: shardMeta?.id || null,
              message: err?.message || String(err),
              stack: err?.stack || null
            });
            throw err;
          } finally {
            if (watchdog) {
              clearTimeout(watchdog);
            }
          }
        },
        {
          collectResults: false,
          signal: abortSignal,
          onResult: async (result, ctx) => {
            const entryIndex = Number.isFinite(ctx?.index) ? ctx.index : 0;
            const entry = batchEntries[entryIndex];
            const orderIndex = Number.isFinite(entry?.orderIndex)
              ? entry.orderIndex
              : (Number.isFinite(entry?.canonicalOrderIndex) ? entry.canonicalOrderIndex : entryIndex);
            if (result?.defer) {
              if (treeSitterOptions?.enabled !== false && treeSitterOptions?.batchByLanguage !== false) {
                bumpTreeSitterMetric('batchDeferrals', 1);
              }
              deferredEntries.push({
                entry,
                missingLanguages: Array.isArray(result.missingLanguages) ? result.missingLanguages : []
              });
              return orderedAppender.skip(orderIndex);
            }
            progress.tick();
            if (shardProgress) {
              shardProgress.count += 1;
              showProgress('Shard', shardProgress.count, shardProgress.total, shardProgress.meta);
            }
            if (!result) {
              return orderedAppender.skip(orderIndex);
            }
            const payload = estimatePostingsPayload(result);
            const reservation = await postingsQueue.reserve(payload);
            return orderedAppender
              .enqueue(orderIndex, result, shardMeta)
              .finally(() => reservation.release());
          },
          onError: async (err, ctx) => {
            const entryIndex = Number.isFinite(ctx?.index) ? ctx.index : 0;
            const entry = batchEntries[entryIndex];
            const orderIndex = Number.isFinite(entry?.orderIndex)
              ? entry.orderIndex
              : (Number.isFinite(entry?.canonicalOrderIndex) ? entry.canonicalOrderIndex : entryIndex);
            const rel = entry?.rel || toPosix(path.relative(runtimeRef.root, entry?.abs || ''));
            logLine(
              `[ordered] skipping failed file ${orderIndex} ${rel} (${err?.message || err})`,
              {
                kind: 'warning',
                mode,
                stage: 'processing',
                file: rel,
                fileIndex: entry?.fileIndex || null,
                shardId: shardMeta?.id || null
              }
            );
            await orderedAppender.skip(orderIndex);
          },
          retries: 2,
          retryDelayMs: 200
        }
      );
    };
    const treeSitterOptions = runtimeRef.languageOptions?.treeSitter;
    const deferMissingMax = Number.isFinite(treeSitterOptions?.deferMissingMax)
      ? Math.max(0, Math.floor(treeSitterOptions.deferMissingMax))
      : 0;
    let pendingEntries = shardEntries;
    try {
      while (pendingEntries.length) {
        const entryBatches = buildTreeSitterEntryBatches(pendingEntries);
        const deferred = [];
        for (const batch of entryBatches) {
          if (treeSitterOptions?.enabled !== false && treeSitterOptions?.batchByLanguage !== false) {
            bumpTreeSitterMetric('batchCount', 1);
            bumpTreeSitterMetric('batchFiles', batch.entries.length);
            setTreeSitterMetricMax('batchMaxFiles', batch.entries.length);
          }
          if (treeSitterOptions?.enabled !== false
            && treeSitterOptions?.batchByLanguage !== false
            && Array.isArray(batch.languages)
            && batch.languages.length) {
            await preloadTreeSitterBatch({ languages: batch.languages, treeSitter: treeSitterOptions, log });
          }
          await runEntryBatch(batch.entries, deferred);
        }
        if (!deferred.length) break;
        const nextEntries = [];
        for (const deferredItem of deferred) {
          const entry = deferredItem.entry;
          const missingLanguages = Array.isArray(deferredItem.missingLanguages)
            ? deferredItem.missingLanguages
            : [];
          entry.treeSitterDeferrals = (Number(entry.treeSitterDeferrals) || 0) + 1;
          if (deferMissingMax === 0 || entry.treeSitterDeferrals > deferMissingMax) {
            entry.treeSitterDisabled = true;
            updateEntryTreeSitterBatch(entry, []);
            nextEntries.push(entry);
            continue;
          }
          if (missingLanguages.length) {
            entry.treeSitterDeferredToEnd = true;
            const merged = normalizeTreeSitterLanguages([
              ...(Array.isArray(entry.treeSitterBatchLanguages) ? entry.treeSitterBatchLanguages : []),
              ...missingLanguages
            ]);
            updateEntryTreeSitterBatch(entry, merged);
          }
          nextEntries.push(entry);
        }
        if (treeSitterOptions?.batchByLanguage !== false) {
          sortEntriesByTreeSitterBatchKey(nextEntries);
        }
        for (const entry of nextEntries) {
          entry.processingOrderIndex = orderIndexState.next++;
          entry.orderIndex = entry.processingOrderIndex;
        }
        pendingEntries = nextEntries;
      }
    } catch (err) {
      // If the shard processing fails before a contiguous `orderIndex` is
      // enqueued, later tasks may be blocked waiting for an ordered flush.
      // Abort rejects any waiting promises to prevent hangs/leaks.
      orderedAppender.abort(err);
      throw err;
    }
  };

  const discoveryLineCounts = discovery?.lineCounts instanceof Map ? discovery.lineCounts : null;
  let lineCounts = discoveryLineCounts;
  if (runtime.shards?.enabled && !lineCounts) {
    const hasEntryLines = entries.some((entry) => Number.isFinite(entry?.lines) && entry.lines > 0);
    if (!hasEntryLines) {
      const lineStart = Date.now();
      const lineConcurrency = Math.max(1, Math.min(32, runtime.cpuConcurrency * 2));
      if (envConfig.verbose === true) {
        log(`→ Shard planning: counting lines (${lineConcurrency} workers)...`);
      }
      lineCounts = await countLinesForEntries(entries, { concurrency: lineConcurrency });
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
    ? planShards(entries, {
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
  const checkpointBatchSize = resolveCheckpointBatchSize(entries.length, shardPlan);
  checkpoint = createBuildCheckpoint({
    buildRoot: runtime.buildRoot,
    mode,
    totalFiles: entries.length,
    batchSize: checkpointBatchSize
  });
  progress = {
    total: entries.length,
    count: 0,
    tick() {
      this.count += 1;
      showProgress('Files', this.count, this.total, { stage: 'processing', mode });
      checkpoint.tick();
    }
  };
  if (shardPlan && shardPlan.length > 1) {
    const shardExecutionPlan = [...shardPlan].sort((a, b) => {
      const costDelta = (b.costMs || 0) - (a.costMs || 0);
      if (costDelta !== 0) return costDelta;
      const lineDelta = (b.lineCount || 0) - (a.lineCount || 0);
      if (lineDelta !== 0) return lineDelta;
      const sizeDelta = b.entries.length - a.entries.length;
      if (sizeDelta !== 0) return sizeDelta;
      return compareStrings(a.label || a.id, b.label || b.id);
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
    let shardBatches = planShardBatches(shardWorkPlan, shardConcurrency, {
      resolveWeight: (workItem) => Number.isFinite(workItem.predictedCostMs)
        ? workItem.predictedCostMs
        : (workItem.shard.costMs || workItem.shard.lineCount || workItem.entries.length || 0),
      resolveTieBreaker: (workItem) => {
        const shardId = workItem.shard?.id || workItem.shard?.label || '';
        const part = Number.isFinite(workItem.partIndex) ? workItem.partIndex : 0;
        return `${shardId}:${part}`;
      }
    });
    if (!shardBatches.length && shardWorkPlan.length) {
      shardBatches = [shardWorkPlan.slice()];
    }
    shardConcurrency = Math.max(1, shardBatches.length);
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
    const runShardWorker = async (batch) => {
      const shardRuntime = createShardRuntime(runtime, {
        fileConcurrency: perShardFileConcurrency,
        importConcurrency: perShardImportConcurrency,
        embeddingConcurrency: perShardEmbeddingConcurrency
      });
      try {
        for (const workItem of batch) {
          const {
            shard,
            entries: shardEntries,
            partIndex,
            partTotal,
            shardIndex,
            shardTotal
          } = workItem;
          const shardLabel = shard.label || shard.id;
          let shardBracket = shardLabel === shard.id ? null : shard.id;
          if (partTotal > 1) {
            const partLabel = `part ${partIndex}/${partTotal}`;
            shardBracket = shardBracket ? `${shardBracket} ${partLabel}` : partLabel;
          }
          const shardDisplay = shardLabel + (shardBracket ? ` [${shardBracket}]` : '');
          log(
            `→ Shard ${shardIndex}/${shardTotal}: ${shardDisplay} (${shardEntries.length} files)`,
            {
              shardId: shard.id,
              shardIndex,
              shardTotal,
              partIndex,
              partTotal,
              fileCount: shardEntries.length
            }
          );
          await processEntries({
            entries: shardEntries,
            runtime: shardRuntime,
            shardMeta: {
              ...shard,
              partIndex,
              partTotal,
              shardIndex,
              shardTotal,
              display: shardDisplay
            },
            stateRef: state
          });
        }
      } finally {
        await shardRuntime.destroy?.();
      }
    };
    await Promise.all(
      shardBatches.map((batch) => runShardWorker(batch))
    );
  } else {
    await processEntries({ entries, runtime, stateRef: state });
  }
  showProgress('Files', progress.total, progress.total, { stage: 'processing', mode });
  checkpoint.finish();
  timing.processMs = Date.now() - processStart;
  const parseSkipCount = state.skippedFiles.filter((entry) => entry?.reason === 'parse-error').length;
  const relationSkipCount = state.skippedFiles.filter((entry) => entry?.reason === 'relation-error').length;
  const skipTotal = parseSkipCount + relationSkipCount;
  if (skipTotal > 0) {
    const parts = [];
    if (parseSkipCount) parts.push(`parse=${parseSkipCount}`);
    if (relationSkipCount) parts.push(`relations=${relationSkipCount}`);
    log(`Warning: skipped ${skipTotal} files due to parse/relations errors (${parts.join(', ')}).`);
  }

  const postingsQueueStats = postingsQueue?.stats ? postingsQueue.stats() : null;
  if (postingsQueueStats) {
    if (timing) timing.postingsQueue = postingsQueueStats;
    if (state) state.postingsQueueStats = postingsQueueStats;
  }

  return { tokenizationStats, shardSummary, shardPlan, postingsQueueStats };
};



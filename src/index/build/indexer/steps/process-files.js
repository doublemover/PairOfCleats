import os from 'node:os';
import path from 'node:path';
import { createTaskQueues, runWithQueue } from '../../../../shared/concurrency.js';
import { getEnvConfig } from '../../../../shared/env.js';
import { fileExt, toPosix } from '../../../../shared/files.js';
import { countLinesForEntries } from '../../../../shared/file-stats.js';
import { log, logLine, showProgress } from '../../../../shared/progress.js';
import { compareStrings } from '../../../../shared/sort.js';
import {
  preloadTreeSitterLanguages,
  pruneTreeSitterLanguages,
  resetTreeSitterParser,
  TREE_SITTER_LANGUAGE_IDS
} from '../../../../lang/tree-sitter.js';
import { createBuildCheckpoint } from '../../build-state.js';
import { createFileProcessor } from '../../file-processor.js';
import { getLanguageForFile } from '../../../language-registry.js';
import { loadStructuralMatches } from '../../../structural.js';
import { planShardBatches, planShards } from '../../shards.js';
import { recordFileMetric } from '../../perf-profile.js';
import { createTokenRetentionState } from './postings.js';

// Ordered appender used to ensure deterministic chunk/doc ids regardless of
// concurrency and shard execution order.
//
// IMPORTANT: The original implementation returned the *flush attempt* promise.
// When an earlier file was slow, results from later files accumulated in
// `pending` until `nextIndex` advanced, creating unbounded buffering and
// eventual V8 OOMs that were highly timing-sensitive (e.g., "--inspect" would
// often avoid the crash).
//
// This version returns a promise that resolves only once the specific
// `orderIndex` has been flushed (i.e., processed in order). That creates
// backpressure via `runWithQueue`'s awaited `onResult`, bounding in-flight
// buffered results to queue concurrency.
const buildOrderedAppender = (handleFileResult, state) => {
  const pending = new Map();
  let nextIndex = 0;
  let flushing = null;
  let aborted = false;

  const abort = (err) => {
    if (aborted) return;
    aborted = true;
    for (const entry of pending.values()) {
      try {
        entry?.reject?.(err);
      } catch {}
    }
    pending.clear();
  };

  const flush = async () => {
    while (pending.has(nextIndex)) {
      const entry = pending.get(nextIndex);
      pending.delete(nextIndex);
      try {
        if (entry?.result) {
          handleFileResult(entry.result, state, entry.shardMeta);
        }
        entry?.resolve?.();
      } catch (err) {
        try { entry?.reject?.(err); } catch {}
        throw err;
      } finally {
        nextIndex += 1;
      }
    }
  };

  const scheduleFlush = async () => {
    if (flushing) return flushing;
    flushing = (async () => {
      try {
        await flush();
      } catch (err) {
        abort(err);
        throw err;
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  };

  return {
    enqueue(orderIndex, result, shardMeta) {
      if (aborted) {
        return Promise.reject(new Error('Ordered appender aborted.'));
      }
      const index = Number.isFinite(orderIndex) ? orderIndex : nextIndex;
      let resolve;
      let reject;
      const done = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      pending.set(index, { result, shardMeta, resolve, reject });
      // Ensure rejections from the flush loop don't surface as unhandled.
      scheduleFlush().catch(() => {});
      return done;
    },
    abort
  };
};

const TREE_SITTER_LANG_IDS = new Set(TREE_SITTER_LANGUAGE_IDS);
const TREE_SITTER_EXT_MAP = new Map([
  ['.tsx', 'tsx'],
  ['.jsx', 'jsx'],
  ['.ts', 'typescript'],
  ['.cts', 'typescript'],
  ['.mts', 'typescript'],
  ['.js', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.jsm', 'javascript'],
  ['.py', 'python'],
  ['.json', 'json'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
  ['.toml', 'toml'],
  ['.md', 'markdown'],
  ['.mdx', 'markdown'],
  ['.css', 'css'],
  ['.scss', 'css'],
  ['.sass', 'css'],
  ['.less', 'css'],
  ['.c', 'clike'],
  ['.h', 'clike'],
  ['.m', 'objc'],
  ['.mm', 'objc'],
  ['.cpp', 'cpp'],
  ['.cc', 'cpp'],
  ['.cxx', 'cpp'],
  ['.hpp', 'cpp'],
  ['.hh', 'cpp'],
  ['.hxx', 'cpp'],
  ['.html', 'html'],
  ['.htm', 'html']
]);
const HTML_EMBEDDED_LANGUAGES = ['javascript', 'css'];

const resolveTreeSitterLanguageForEntry = (entry) => {
  const extRaw = typeof entry?.ext === 'string' && entry.ext ? entry.ext : fileExt(entry?.abs || entry?.rel || '');
  const ext = typeof extRaw === 'string' ? extRaw.toLowerCase() : '';
  const extLang = ext ? TREE_SITTER_EXT_MAP.get(ext) : null;
  if (extLang && TREE_SITTER_LANG_IDS.has(extLang)) return extLang;
  const lang = getLanguageForFile(ext, entry?.rel || '');
  const languageId = lang?.id || null;
  return languageId && TREE_SITTER_LANG_IDS.has(languageId) ? languageId : null;
};

const resolveTreeSitterBatchInfo = (entry, treeSitterOptions) => {
  const primary = resolveTreeSitterLanguageForEntry(entry);
  if (!primary) return { key: 'none', languages: [] };
  if (treeSitterOptions?.languagePasses !== false) {
    return { key: primary, languages: [primary] };
  }
  const languages = new Set([primary]);
  if (treeSitterOptions?.batchEmbeddedLanguages !== false && primary === 'html') {
    const maxLoaded = Number.isFinite(treeSitterOptions?.maxLoadedLanguages)
      ? Math.max(1, Math.floor(treeSitterOptions.maxLoadedLanguages))
      : null;
    const embeddedBudget = maxLoaded ? Math.max(0, maxLoaded - 1) : null;
    let embeddedCount = 0;
    for (const lang of HTML_EMBEDDED_LANGUAGES) {
      if (embeddedBudget != null && embeddedCount >= embeddedBudget) break;
      if (!TREE_SITTER_LANG_IDS.has(lang)) continue;
      languages.add(lang);
      embeddedCount += 1;
    }
  }
  const normalized = Array.from(languages).filter((lang) => TREE_SITTER_LANG_IDS.has(lang)).sort();
  const key = normalized.length ? normalized.join('+') : 'none';
  return { key, languages: normalized };
};

const applyTreeSitterBatching = (entries, treeSitterOptions, envConfig, { allowReorder = true } = {}) => {
  if (!treeSitterOptions || treeSitterOptions.enabled === false) return;
  if (treeSitterOptions.batchByLanguage === false) return;
  if (!Array.isArray(entries) || entries.length < 2) return;

  const batchMeta = new Map();
  for (const entry of entries) {
    const info = resolveTreeSitterBatchInfo(entry, treeSitterOptions);
    entry.treeSitterBatchKey = info.key;
    entry.treeSitterBatchLanguages = info.languages;
    entry.treeSitterAllowedLanguages = info.languages;
    batchMeta.set(info.key, info.languages);
  }

  if (allowReorder) {
    entries.sort((a, b) => {
      const keyA = a.treeSitterBatchKey || 'none';
      const keyB = b.treeSitterBatchKey || 'none';
      const keyDelta = compareStrings(keyA, keyB);
      if (keyDelta !== 0) return keyDelta;
      return compareStrings(a.rel || '', b.rel || '');
    });
    entries.forEach((entry, index) => {
      entry.orderIndex = index;
    });
  }

  if (envConfig?.verbose === true && batchMeta.size > 1 && allowReorder) {
    const keys = Array.from(batchMeta.keys()).sort();
    log(`[tree-sitter] Batching files by language: ${keys.join(', ')}.`);
  }
};

const normalizeTreeSitterLanguages = (languages) => {
  const output = new Set();
  for (const language of languages || []) {
    if (TREE_SITTER_LANG_IDS.has(language)) output.add(language);
  }
  return Array.from(output).sort();
};

const updateEntryTreeSitterBatch = (entry, languages) => {
  const normalized = normalizeTreeSitterLanguages(languages);
  entry.treeSitterBatchLanguages = normalized;
  entry.treeSitterBatchKey = normalized.length ? normalized.join('+') : 'none';
  entry.treeSitterAllowedLanguages = normalized;
};

const sortEntriesByTreeSitterBatchKey = (entries) => {
  entries.sort((a, b) => {
    const deferA = a.treeSitterDeferredToEnd ? 1 : 0;
    const deferB = b.treeSitterDeferredToEnd ? 1 : 0;
    if (deferA !== deferB) return deferA - deferB;
    const keyA = a.treeSitterBatchKey || 'none';
    const keyB = b.treeSitterBatchKey || 'none';
    const keyDelta = compareStrings(keyA, keyB);
    if (keyDelta !== 0) return keyDelta;
    return compareStrings(a.rel || '', b.rel || '');
  });
};

const resolveNextOrderIndex = (entries) => {
  let maxIndex = -1;
  for (const entry of entries) {
    const orderIndex = Number.isFinite(entry?.orderIndex) ? entry.orderIndex : -1;
    if (orderIndex > maxIndex) maxIndex = orderIndex;
  }
  return maxIndex + 1;
};

const assignFileIndexes = (entries) => {
  if (!Array.isArray(entries)) return;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry || typeof entry !== 'object') continue;
    entry.fileIndex = i + 1;
  }
};

const buildTreeSitterEntryBatches = (entries) => {
  const batches = [];
  let current = null;
  for (const entry of entries) {
    const key = entry.treeSitterBatchKey || 'none';
    const languages = Array.isArray(entry.treeSitterBatchLanguages) ? entry.treeSitterBatchLanguages : [];
    if (!current || current.key !== key) {
      current = { key, languages, entries: [] };
      batches.push(current);
    }
    current.entries.push(entry);
  }
  return batches;
};

const preloadTreeSitterBatch = async ({ languages, treeSitter, log }) => {
  if (!treeSitter || treeSitter.enabled === false) return;
  if (!Array.isArray(languages) || !languages.length) return;
  try {
    await preloadTreeSitterLanguages(languages, {
      log,
      parallel: false,
      maxLoadedLanguages: treeSitter.maxLoadedLanguages
    });
  } catch {
    // Best-effort preload; parsing will fall back if a grammar fails to load.
  }
};

const resolveCheckpointBatchSize = (totalFiles, shardPlan) => {
  if (!Number.isFinite(totalFiles) || totalFiles <= 0) return 10;
  const minBatch = 10;
  const maxBatch = 250;
  if (Array.isArray(shardPlan) && shardPlan.length) {
    const perShard = Math.max(1, Math.ceil(totalFiles / shardPlan.length));
    const target = Math.ceil(perShard / 10);
    return Math.max(minBatch, Math.min(maxBatch, target));
  }
  const target = Math.ceil(totalFiles / 200);
  return Math.max(minBatch, Math.min(maxBatch, target));
};

const createShardRuntime = (baseRuntime, { fileConcurrency, importConcurrency, embeddingConcurrency }) => {
  const baseWorkerPools = baseRuntime.workerPools;
  const baseWorkerPool = baseRuntime.workerPool;
  const baseQuantizePool = baseRuntime.quantizePool;
  const ioConcurrency = Math.max(fileConcurrency, importConcurrency);
  const cpuLimit = Math.max(1, os.cpus().length * 2);
  const cpuConcurrency = Math.max(1, Math.min(cpuLimit, fileConcurrency));
  // Keep shard workers from running too far ahead of the ordered append cursor.
  // Large pending windows can accumulate many completed-but-unappended file results
  // (especially when one earlier file is slow), which is a common source of V8 OOM
  // that often disappears under `--inspect`.
  const maxFilePending = Math.min(256, Math.max(32, fileConcurrency * 4));
  const maxIoPending = Math.min(512, Math.max(64, ioConcurrency * 4));
  const maxEmbeddingPending = Math.min(64, Math.max(16, embeddingConcurrency * 8));
  const queues = createTaskQueues({
    ioConcurrency,
    cpuConcurrency,
    embeddingConcurrency,
    ioPendingLimit: maxIoPending,
    cpuPendingLimit: maxFilePending,
    embeddingPendingLimit: maxEmbeddingPending
  });
  const destroyQueues = async () => {
    await Promise.all([
      queues.io.onIdle(),
      queues.cpu.onIdle(),
      queues.embedding.onIdle()
    ]);
    queues.io.clear();
    queues.cpu.clear();
    queues.embedding.clear();
  };
  const destroy = async () => {
    await destroyQueues();
    if (baseWorkerPools && baseWorkerPools !== baseRuntime.workerPools && baseWorkerPools.destroy) {
      await baseWorkerPools.destroy();
    } else if (baseWorkerPool && baseWorkerPool !== baseRuntime.workerPool && baseWorkerPool.destroy) {
      await baseWorkerPool.destroy();
    }
  };
  return {
    ...baseRuntime,
    fileConcurrency,
    importConcurrency,
    ioConcurrency,
    cpuConcurrency,
    embeddingConcurrency,
    queues,
    workerPools: baseWorkerPools,
    workerPool: baseWorkerPool,
    quantizePool: baseQuantizePool,
    destroyQueues,
    destroy
  };
};

export const processFiles = async ({
  mode,
  runtime,
  discovery,
  entries,
  importResult,
  contextWin,
  timing,
  crashLogger,
  state,
  perfProfile,
  cacheReporter,
  seenFiles,
  incrementalState,
  relationsEnabled,
  shardPerfProfile
}) => {
  log('Processing and indexing files...');
  crashLogger.updatePhase('processing');
  const processStart = Date.now();
  log(
    `Indexing Concurrency: Files: ${runtime.fileConcurrency}, ` +
    `Imports: ${runtime.importConcurrency}, IO: ${runtime.ioConcurrency}, CPU: ${runtime.cpuConcurrency}`
  );
  const envConfig = getEnvConfig();
  const showFileProgress = envConfig.verbose === true;

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
  let checkpoint = null;
  let progress = null;
  const orderedAppender = buildOrderedAppender(
    (result, stateRef, shardMeta) => {
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
      if (result.fileRelations) {
        stateRef.fileRelations.set(result.relKey, result.fileRelations);
      }
    },
    state
  );
  applyTreeSitterBatching(entries, runtime.languageOptions?.treeSitter, envConfig, {
    allowReorder: runtime.shards?.enabled !== true
  });
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
      dictConfig: runtimeRef.dictConfig,
      dictWords: runtimeRef.dictWords,
      dictShared: runtimeRef.dictShared,
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
      fileScan: runtimeRef.fileScan,
      featureMetrics: runtimeRef.featureMetrics
    });
    const runEntryBatch = async (batchEntries, deferredEntries) => {
      await runWithQueue(
        runtimeRef.queues.cpu,
        batchEntries,
        async (entry, fileIndex) => {
          const stableFileIndex = Number.isFinite(entry?.fileIndex)
            ? entry.fileIndex
            : (Number.isFinite(fileIndex) ? fileIndex + 1 : null);
          if (showFileProgress) {
            const rel = entry.rel || toPosix(path.relative(runtimeRef.root, entry.abs));
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
          }
        },
        {
          collectResults: false,
          onResult: (result, index) => {
            const entry = batchEntries[index];
            const orderIndex = Number.isFinite(entry?.orderIndex) ? entry.orderIndex : index;
            if (result?.defer) {
              deferredEntries.push({
                entry,
                missingLanguages: Array.isArray(result.missingLanguages) ? result.missingLanguages : []
              });
              return orderedAppender.enqueue(orderIndex, null, shardMeta);
            }
            progress.tick();
            if (shardProgress) {
              shardProgress.count += 1;
              showProgress('Shard', shardProgress.count, shardProgress.total, shardProgress.meta);
            }
            return orderedAppender.enqueue(orderIndex, result, shardMeta);
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
          if (treeSitterOptions?.languagePasses === false
            && treeSitterOptions?.enabled !== false
            && Array.isArray(batch.languages)
            && batch.languages.length) {
            resetTreeSitterParser({ hard: true });
            pruneTreeSitterLanguages(batch.languages, {
              log,
              maxLoadedLanguages: treeSitterOptions?.maxLoadedLanguages,
              onlyIfExceeds: true
            });
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
          entry.orderIndex = orderIndexState.next++;
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

  return { tokenizationStats, shardSummary, shardPlan };
};


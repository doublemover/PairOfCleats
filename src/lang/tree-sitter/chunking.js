import { LANG_CONFIG, LANGUAGE_GRAMMAR_KEYS } from './config.js';
import { isTreeSitterEnabled } from './options.js';
import { getNativeTreeSitterParser, loadNativeTreeSitterGrammar } from './native-runtime.js';
import { treeSitterState } from './state.js';
import { getTreeSitterWorkerPool, sanitizeTreeSitterOptions } from './worker.js';
import { recordNodeDensity, resolveTraversalBudget } from './chunking/budget.js';
import {
  ensureChunkCache,
  loadCachedChunks,
  resolveChunkCacheKey,
  resolvePersistentChunkCacheRoot,
  storeCachedChunks
} from './chunking/cache.js';
import { gatherChunkNodes, gatherChunksWithQuery } from './chunking/assembly.js';
import {
  countLines,
  exceedsTreeSitterLimits,
  resolveParseTimeoutMs,
  shouldGuardNativeParser
} from './chunking/policies.js';
import { resolveLanguageForExt } from './chunking/planning.js';

const loggedParseFailures = new Set();
const loggedParseTimeouts = new Set();
const loggedUnavailable = new Set();
const loggedTraversalBudget = new Set();
const loggedPlatformGuards = new Set();
const MAX_TIMEOUTS_PER_RUN = 3;

/**
 * Increment tree-sitter metric counters when metrics state is enabled.
 * @param {string} key
 * @param {number} [amount=1]
 * @returns {void}
 */
const bumpMetric = (key, amount = 1) => {
  if (!key) return;
  const metrics = treeSitterState.metrics;
  if (!metrics || typeof metrics !== 'object') return;
  const current = Number.isFinite(metrics[key]) ? metrics[key] : 0;
  metrics[key] = current + amount;
};

/**
 * Build chunks with tree-sitter parsing in the main thread.
 *
 * Strict-mode behavior differs from default fallback behavior: when parsing is
 * available but chunk extraction cannot proceed safely, strict mode returns a
 * deterministic whole-file chunk envelope or throws `ERR_TREE_SITTER_STRICT`
 * for true fallback-required paths.
 *
 * @param {{text:string,languageId?:string|null,ext?:string|null,options?:object}} input
 * @returns {Array<object>|null}
 */
export function buildTreeSitterChunks({ text, languageId, ext, options }) {
  const resolvedId = resolveLanguageForExt(languageId, ext);
  if (!resolvedId) return null;
  if (!isTreeSitterEnabled(options, resolvedId)) return null;

  const strict = options?.treeSitter?.strict === true;
  const failStrict = (reason, message, extra = {}) => {
    if (!strict) return null;
    const err = new Error(message);
    err.code = 'ERR_TREE_SITTER_STRICT';
    err.reason = reason;
    err.languageId = resolvedId;
    Object.assign(err, extra);
    throw err;
  };

  const buildWholeFileChunk = () => ([{
    start: 0,
    end: text.length,
    name: 'file',
    kind: 'File',
    meta: { treeSitter: true, wholeFile: true }
  }]);

  if (shouldGuardNativeParser(resolvedId, options)) {
    bumpMetric('fallbacks', 1);
    const guardKey = `${resolvedId}:native-crash-guard`;
    if (options?.log && !loggedPlatformGuards.has(guardKey)) {
      options.log(
        `[tree-sitter] Native parser guarded for ${resolvedId} on ${process.platform}; ` +
        'skipping in-process parse due known native crash path.'
      );
      loggedPlatformGuards.add(guardKey);
    }
    if (strict) {
      // In strict mode, avoid process-terminating parser paths but still return
      // a deterministic tree-sitter-backed chunk envelope.
      return buildWholeFileChunk();
    }
    return null;
  }

  if (treeSitterState.disabledLanguages?.has(resolvedId)) {
    bumpMetric('fallbacks', 1);
    return failStrict(
      'disabled',
      `Tree-sitter disabled for ${resolvedId}; strict mode does not allow fallback.`
    );
  }

  if (exceedsTreeSitterLimits(text, options, resolvedId)) return null;

  const metricsCollector = options?.metricsCollector;
  const shouldRecordMetrics = metricsCollector && typeof metricsCollector.add === 'function';
  const shouldTrackDensity = options?.treeSitter?.adaptive !== false;

  let lineCount = null;
  const getLineCount = () => {
    if (!shouldRecordMetrics && !shouldTrackDensity) return 0;
    if (lineCount === null) lineCount = countLines(text);
    return lineCount;
  };

  const metricsStart = shouldRecordMetrics ? Date.now() : 0;
  const recordMetrics = () => {
    if (!shouldRecordMetrics) return;
    const durationMs = Date.now() - metricsStart;
    metricsCollector.add('treeSitter', resolvedId, getLineCount(), durationMs);
  };

  const cacheKey = resolveChunkCacheKey(options, resolvedId);
  const cacheRef = cacheKey ? ensureChunkCache(options) : null;
  const persistentCacheRoot = cacheKey ? resolvePersistentChunkCacheRoot(options) : null;
  if (cacheKey && cacheRef) {
    const cached = loadCachedChunks({
      cache: cacheRef.cache,
      key: cacheKey,
      cacheRoot: persistentCacheRoot,
      bumpMetric
    });
    if (cached) {
      recordMetrics();
      return cached;
    }
  }

  const shouldDeferMissing = options?.treeSitterMissingLanguages
    && options?.treeSitter?.deferMissing !== false;

  const parser = getNativeTreeSitterParser(resolvedId, options);
  if (!parser) {
    if (shouldDeferMissing) {
      options.treeSitterMissingLanguages.add(resolvedId);
      bumpMetric('fallbacks', 1);
      return null;
    }
    if (options?.treeSitterMissingLanguages) {
      options.treeSitterMissingLanguages.add(resolvedId);
    }
    bumpMetric('fallbacks', 1);
    if (strict) {
      return failStrict(
        'missing-parser',
        `Tree-sitter unavailable for ${resolvedId}; strict mode does not allow fallback.`
      );
    }
    if (options?.log && !loggedUnavailable.has(resolvedId)) {
      options.log(`Tree-sitter unavailable for ${resolvedId}; falling back to heuristic chunking.`);
      loggedUnavailable.add(resolvedId);
    }
    return null;
  }

  const loadedGrammar = loadNativeTreeSitterGrammar(resolvedId);
  const grammarLanguage = loadedGrammar?.language || null;
  if (grammarLanguage) {
    treeSitterState.languageCache?.set?.(resolvedId, { language: grammarLanguage, error: null });
    const grammarKey = LANGUAGE_GRAMMAR_KEYS?.[resolvedId];
    if (grammarKey) {
      treeSitterState.grammarCache?.set?.(grammarKey, { language: grammarLanguage, error: null });
    }
  }

  const config = LANG_CONFIG[resolvedId];
  if (!config) {
    bumpMetric('fallbacks', 1);
    if (strict) {
      return failStrict(
        'missing-config',
        `Tree-sitter config missing for ${resolvedId}; strict mode does not allow fallback.`
      );
    }
    return null;
  }

  const traversalBudget = resolveTraversalBudget(options, resolvedId, { bumpMetric });
  let tree = null;

  try {
    try {
      const parseTimeoutMs = resolveParseTimeoutMs(options, resolvedId);
      if (typeof parser.setTimeoutMicros === 'function') {
        parser.setTimeoutMicros(parseTimeoutMs ? parseTimeoutMs * 1000 : 0);
      }
      tree = parser.parse(text);
    } catch (err) {
      recordMetrics();
      const message = err?.message || String(err);
      if (/timeout/i.test(message)) {
        bumpMetric('parseTimeouts', 1);
        bumpMetric('fallbacks', 1);
        if (strict) {
          return failStrict(
            'timeout',
            `Tree-sitter parse timed out for ${resolvedId}; strict mode does not allow fallback.`,
            { parseError: message }
          );
        }
        if (options?.log && !loggedParseTimeouts.has(resolvedId)) {
          options.log(`Tree-sitter parse timed out for ${resolvedId}; falling back to heuristic chunking.`);
          loggedParseTimeouts.add(resolvedId);
        }
        const counts = treeSitterState.timeoutCounts;
        if (counts) {
          const nextCount = (counts.get(resolvedId) || 0) + 1;
          counts.set(resolvedId, nextCount);
          if (nextCount >= MAX_TIMEOUTS_PER_RUN && treeSitterState.disabledLanguages) {
            treeSitterState.disabledLanguages.add(resolvedId);
            if (options?.log && !treeSitterState.loggedTimeoutDisable?.has(resolvedId)) {
              options.log(
                `Tree-sitter disabled for ${resolvedId} after ${nextCount} timeouts; ` +
                'using heuristic chunking for the remainder of this run.'
              );
              treeSitterState.loggedTimeoutDisable?.add?.(resolvedId);
            }
          }
        }
        return null;
      }

      bumpMetric('parseFailures', 1);
      bumpMetric('fallbacks', 1);
      if (strict) {
        return failStrict(
          'parse-failed',
          `Tree-sitter parse failed for ${resolvedId}; strict mode does not allow fallback.`,
          { parseError: message }
        );
      }
      return null;
    }

    let rootNode = null;
    try {
      rootNode = tree.rootNode;
    } catch {
      recordMetrics();
      bumpMetric('parseFailures', 1);
      bumpMetric('fallbacks', 1);
      if (strict) {
        return failStrict(
          'parse-failed',
          `Tree-sitter parse failed for ${resolvedId}; strict mode does not allow fallback.`
        );
      }
      if (!loggedParseFailures.has(resolvedId) && options?.log) {
        options.log(`Tree-sitter parse failed for ${resolvedId}; falling back to heuristic chunking.`);
        loggedParseFailures.add(resolvedId);
      }
      return null;
    }

    let queryResult = null;
    try {
      queryResult = gatherChunksWithQuery(
        rootNode,
        text,
        config,
        traversalBudget,
        resolvedId,
        options,
        bumpMetric
      );
    } catch {
      queryResult = null;
    }

    if (queryResult?.usedQuery) {
      if (Array.isArray(queryResult.chunks) && queryResult.chunks.length) {
        if (cacheKey && cacheRef) {
          storeCachedChunks({
            cache: cacheRef.cache,
            key: cacheKey,
            chunks: queryResult.chunks,
            maxEntries: cacheRef.maxEntries,
            cacheRoot: persistentCacheRoot,
            bumpMetric
          });
        }
        recordMetrics();
        return queryResult.chunks;
      }

      if (!queryResult.shouldFallback) {
        recordMetrics();
        bumpMetric('fallbacks', 1);
        if (strict) {
          // A query can legitimately match no "chunkable" nodes (e.g. tiny files).
          // In strict mode, avoid falling back to heuristics by emitting one whole-file chunk.
          return buildWholeFileChunk();
        }
        return null;
      }

      if (queryResult.reason && options?.log) {
        const key = `query:${resolvedId}:${queryResult.reason}`;
        if (!loggedTraversalBudget.has(key)) {
          const fallbackLabel = strict
            ? 'Falling back to traversal chunking.'
            : 'Falling back to heuristic chunking.';
          options.log(
            `Tree-sitter query aborted for ${resolvedId} (${queryResult.reason}); ` +
            `visited=${queryResult.visited ?? 'n/a'} matched=${queryResult.matched ?? 'n/a'}. ` +
            fallbackLabel
          );
          loggedTraversalBudget.add(key);
        }
      }
    }

    let traversalResult = null;
    try {
      traversalResult = gatherChunkNodes(rootNode, text, config, traversalBudget);
      if (shouldTrackDensity && traversalResult?.visited) {
        recordNodeDensity(resolvedId, traversalResult.visited, getLineCount());
      }
      if (!traversalResult?.chunks) {
        recordMetrics();
        bumpMetric('fallbacks', 1);
        if (strict) {
          // Traversal budgets can abort on dense ASTs. In strict mode, emit a
          // whole-file chunk rather than falling back to heuristics.
          return buildWholeFileChunk();
        }
        const key = `${resolvedId}:${traversalResult?.reason || 'budget'}`;
        if (options?.log && !loggedTraversalBudget.has(key)) {
          options.log(
            `Tree-sitter traversal aborted for ${resolvedId} (${traversalResult?.reason}); `
              + `visited=${traversalResult?.visited ?? 'n/a'} matched=${traversalResult?.matched ?? 'n/a'}. `
              + 'Falling back to heuristic chunking.'
          );
          loggedTraversalBudget.add(key);
        }
        return null;
      }
    } catch {
      recordMetrics();
      bumpMetric('parseFailures', 1);
      bumpMetric('fallbacks', 1);
      if (strict) {
        return failStrict(
          'parse-failed',
          `Tree-sitter parse failed for ${resolvedId}; strict mode does not allow fallback.`
        );
      }
      if (!loggedParseFailures.has(resolvedId) && options?.log) {
        options.log(`Tree-sitter parse failed for ${resolvedId}; falling back to heuristic chunking.`);
        loggedParseFailures.add(resolvedId);
      }
      return null;
    }

    if (!traversalResult.chunks.length) {
      recordMetrics();
      bumpMetric('fallbacks', 1);
      if (strict) {
        return buildWholeFileChunk();
      }
      return null;
    }

    if (cacheKey && cacheRef) {
      storeCachedChunks({
        cache: cacheRef.cache,
        key: cacheKey,
        chunks: traversalResult.chunks,
        maxEntries: cacheRef.maxEntries,
        cacheRoot: persistentCacheRoot,
        bumpMetric
      });
    }
    recordMetrics();
    return traversalResult.chunks;
  } finally {
    // Tree objects can retain sizable parser-side allocations and should be
    // explicitly released after chunk extraction.
    try {
      if (tree && typeof tree.delete === 'function') tree.delete();
    } catch {
      // ignore disposal failures
    }

    // Some tree-sitter builds retain internal parse stack allocations across parses.
    // Resetting keeps memory bounded across long-running indexing jobs.
    try {
      if (parser && typeof parser.reset === 'function') parser.reset();
    } catch {
      // ignore reset failures
    }
  }
}

/**
 * Build tree-sitter chunks using worker pool when configured.
 *
 * Worker results are treated as advisory: null/empty/error outcomes fall back
 * to synchronous parsing to preserve deterministic chunk coverage.
 *
 * @param {{text:string,languageId?:string|null,ext?:string|null,options?:object}} input
 * @returns {Promise<Array<object>|null>}
 */
export async function buildTreeSitterChunksAsync({ text, languageId, ext, options }) {
  // If tree-sitter is disabled (or no config provided), keep the synchronous behavior.
  if (!options?.treeSitter || options.treeSitter.enabled === false) {
    return buildTreeSitterChunks({ text, languageId, ext, options });
  }

  const resolvedId = resolveLanguageForExt(languageId, ext);
  if (!resolvedId) return null;

  // Avoid spinning up / dispatching to workers when we already know we will skip tree-sitter.
  if (!isTreeSitterEnabled(options, resolvedId)) return null;
  if (treeSitterState.disabledLanguages?.has(resolvedId)) return null;
  if (exceedsTreeSitterLimits(text, options, resolvedId)) return null;
  if (!LANG_CONFIG[resolvedId]) return null;

  const cacheKey = resolveChunkCacheKey(options, resolvedId);
  const cacheRef = cacheKey ? ensureChunkCache(options) : null;
  const persistentCacheRoot = cacheKey ? resolvePersistentChunkCacheRoot(options) : null;
  if (cacheKey && cacheRef) {
    const cached = loadCachedChunks({
      cache: cacheRef.cache,
      key: cacheKey,
      cacheRoot: persistentCacheRoot,
      bumpMetric
    });
    if (cached) return cached;
  }

  const pool = await getTreeSitterWorkerPool(options?.treeSitter?.worker, options);
  if (!pool) {
    return buildTreeSitterChunks({ text, languageId, ext, options });
  }

  const metricsCollector = options?.metricsCollector;
  const shouldRecordMetrics = metricsCollector && typeof metricsCollector.add === 'function';
  const lineCount = shouldRecordMetrics ? countLines(text) : 0;
  const metricsStart = shouldRecordMetrics ? Date.now() : 0;

  const payload = {
    text,
    languageId,
    ext,
    treeSitter: sanitizeTreeSitterOptions(options?.treeSitter)
  };

  // Avoid double-counting tree-sitter metrics when falling back to in-thread parsing.
  const fallbackOptions = shouldRecordMetrics
    ? { ...options, metricsCollector: null }
    : options;

  try {
    const maxQueue = Number(treeSitterState.treeSitterWorkerMaxQueue);
    const queueSize = Number(pool?.queueSize);
    if (Number.isFinite(maxQueue) && maxQueue > 0
      && Number.isFinite(queueSize) && queueSize >= maxQueue) {
      bumpMetric('workerFallbacks', 1);
      return buildTreeSitterChunks({ text, languageId, ext, options: fallbackOptions });
    }
    const runOptions = { name: 'parseTreeSitter' };
    if (options?.abortSignal) {
      runOptions.signal = options.abortSignal;
    }
    const result = await pool.run(payload, runOptions);
    if (Array.isArray(result) && result.length) {
      if (cacheKey && cacheRef) {
        storeCachedChunks({
          cache: cacheRef.cache,
          key: cacheKey,
          chunks: result,
          maxEntries: cacheRef.maxEntries,
          cacheRoot: persistentCacheRoot,
          bumpMetric
        });
      }
      return result;
    }

    // Null/empty results from a worker are treated as a failure signal; retry in-thread for determinism.
    bumpMetric('workerFallbacks', 1);
    return buildTreeSitterChunks({ text, languageId, ext, options: fallbackOptions });
  } catch (err) {
    if (options?.log && !treeSitterState.loggedWorkerFailures.has('run')) {
      options.log(`[tree-sitter] Worker parse failed; falling back to main thread (${err?.message || err}).`);
      treeSitterState.loggedWorkerFailures.add('run');
    }
    bumpMetric('workerFallbacks', 1);
    return buildTreeSitterChunks({ text, languageId, ext, options: fallbackOptions });
  } finally {
    if (shouldRecordMetrics) {
      const durationMs = Date.now() - metricsStart;
      metricsCollector.add('treeSitter', resolvedId, lineCount, durationMs);
    }
  }
}

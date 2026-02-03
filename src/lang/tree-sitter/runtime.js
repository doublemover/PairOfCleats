import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { LANGUAGE_WASM_FILES, TREE_SITTER_LANGUAGE_IDS } from './config.js';
import { treeSitterState } from './state.js';

const require = createRequire(import.meta.url);

const clampPositiveInt = (value, { min = 1, max = 64 } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

// Tree-sitter Parser instances can hold non-trivial native/WASM memory.
// In multi-language repos this can balloon quickly if we cache one Parser per
// language indefinitely. We cap the parser cache and evict LRU entries.
const DEFAULT_MAX_PARSER_CACHE = (() => {
  try {
    const envRaw = process.env.POC_TREE_SITTER_MAX_PARSERS;
    const envMax = clampPositiveInt(envRaw, { min: 1, max: 16 });
    if (envMax) return envMax;

    const cpuCount = Array.isArray(os.cpus?.()) ? os.cpus().length : 0;
    // Keep this intentionally small; we only parse on the main thread.
    return Math.max(2, Math.min(4, cpuCount || 4));
  } catch {
    return 4;
  }
})();

// Default cap for retained WASM grammars.
//
// - On the main thread we default to retaining all supported grammars because
//   synchronous chunkers may rely on preloaded grammars.
// - On worker threads we keep a conservative cap by default because caches are
//   multiplied per thread.
const DEFAULT_MAX_WASM_LANGUAGE_CACHE = (() => {
  // Environment override applies everywhere.
  try {
    const envRaw = process.env.POC_TREE_SITTER_MAX_LANGUAGES
      || process.env.PAIR_OF_CLEATS_TREE_SITTER_MAX_LANGUAGES;
    const envMax = clampPositiveInt(envRaw, { min: 1, max: 64 });
    if (envMax) return envMax;
  } catch {
    // ignore
  }

  if (isMainThread) return TREE_SITTER_LANGUAGE_IDS.length;
  return process.platform === 'win32' ? 6 : 8;
})();

function resolveMaxLoadedLanguages(options = {}) {
  const raw = options?.maxLoadedLanguages
    ?? options?.treeSitter?.maxLoadedLanguages
    ?? null;
  const parsed = clampPositiveInt(raw, { min: 1, max: 64 });
  return parsed || DEFAULT_MAX_WASM_LANGUAGE_CACHE;
}

const bumpMetric = (key, amount = 1) => {
  if (!key) return;
  const metrics = treeSitterState.metrics;
  if (!metrics || typeof metrics !== 'object') return;
  const current = Number.isFinite(metrics[key]) ? metrics[key] : 0;
  metrics[key] = current + amount;
};

export const resetTreeSitterStats = () => {
  const metrics = treeSitterState.metrics;
  if (metrics && typeof metrics === 'object') {
    for (const key of Object.keys(metrics)) {
      metrics[key] = 0;
    }
  }
  treeSitterState.loggedMissing?.clear?.();
  treeSitterState.loggedMissingWasm?.clear?.();
  treeSitterState.loggedQueryFailures?.clear?.();
  treeSitterState.loggedEvictionWarnings?.clear?.();
  treeSitterState.loggedInitFailure?.clear?.();
  treeSitterState.loggedWorkerFailures?.clear?.();
  treeSitterState.loggedTimeoutDisable?.clear?.();
  treeSitterState.timeoutCounts?.clear?.();
  treeSitterState.disabledLanguages?.clear?.();
  treeSitterState.nodeDensity?.clear?.();
  treeSitterState.loggedAdaptiveBudgets?.clear?.();
};

export const getTreeSitterStats = () => {
  const metrics = treeSitterState.metrics || {};
  return {
    ...metrics,
    cache: {
      wasmLanguages: treeSitterState.wasmLanguageCache?.size || 0,
      languageEntries: treeSitterState.languageCache?.size || 0,
      activeLanguageId: treeSitterState.sharedParserLanguageId || null
    },
    paths: {
      wasmRoot: treeSitterState.wasmRoot || null,
      wasmRuntimePath: treeSitterState.wasmRuntimePath || null
    }
  };
};

export const getTreeSitterCacheSnapshot = () => ({
  wasmKeys: Array.from(treeSitterState.wasmLanguageCache?.keys?.() || []),
  languageIds: Array.from(treeSitterState.languageCache?.keys?.() || []),
  activeLanguageId: treeSitterState.sharedParserLanguageId || null
});

function touchWasmLanguageCacheEntry(wasmKey) {
  if (!wasmKey || !treeSitterState.wasmLanguageCache.has(wasmKey)) return;
  const value = treeSitterState.wasmLanguageCache.get(wasmKey);
  treeSitterState.wasmLanguageCache.delete(wasmKey);
  treeSitterState.wasmLanguageCache.set(wasmKey, value);
}

function removeLanguageCacheEntriesForWasmKey(wasmKey) {
  if (!wasmKey) return;
  const toDelete = [];
  for (const langId of treeSitterState.languageCache.keys()) {
    if (LANGUAGE_WASM_FILES[langId] === wasmKey) toDelete.push(langId);
  }
  for (const langId of toDelete) {
    treeSitterState.languageCache.delete(langId);
    treeSitterState.queryCache?.delete?.(langId);
  }
}

function disposeWasmLanguageEntry(entry, skipDispose = false) {
  if (skipDispose) return;
  const language = entry?.language;
  if (language && typeof language.delete === 'function') {
    try {
      language.delete();
    } catch {
      // ignore disposal failures
    }
  }
}

function evictOldWasmLanguages(maxSize, options = {}) {
  const max = Number(maxSize);
  if (!Number.isFinite(max) || max <= 0) return;

  // Never evict the grammar currently active on the shared parser.
  const activeLangId = treeSitterState.sharedParserLanguageId;
  const activeWasmKey = activeLangId ? LANGUAGE_WASM_FILES[activeLangId] : null;

  let guard = 0;
  while (treeSitterState.wasmLanguageCache.size > max && guard < 1024) {
    const oldestKey = treeSitterState.wasmLanguageCache.keys().next().value;
    if (!oldestKey) break;

    if (activeWasmKey && oldestKey === activeWasmKey) {
      // Move the active grammar to the back and try the next.
      touchWasmLanguageCacheEntry(oldestKey);
      guard += 1;
      continue;
    }

    const entry = treeSitterState.wasmLanguageCache.get(oldestKey);
    treeSitterState.wasmLanguageCache.delete(oldestKey);
    removeLanguageCacheEntriesForWasmKey(oldestKey);
    disposeWasmLanguageEntry(entry, options?.skipDispose === true);
    bumpMetric('wasmEvictions', 1);
  }

  if (guard >= 1024 && options?.log) {
    options.log('[tree-sitter] WASM grammar eviction guard tripped; cache may remain oversized.');
  }
}

function resolveLanguageId(languageId) {
  return typeof languageId === 'string' ? languageId : null;
}

function resolveWasmRoot() {
  if (treeSitterState.wasmRoot) return treeSitterState.wasmRoot;
  const pkgPath = require.resolve('tree-sitter-wasms/package.json');
  treeSitterState.wasmRoot = path.join(path.dirname(pkgPath), 'out');
  return treeSitterState.wasmRoot;
}

function resolveRuntimePath() {
  if (treeSitterState.wasmRuntimePath) return treeSitterState.wasmRuntimePath;
  const candidates = [
    'web-tree-sitter/web-tree-sitter.wasm',
    'web-tree-sitter/tree-sitter.wasm'
  ];
  for (const candidate of candidates) {
    try {
      treeSitterState.wasmRuntimePath = require.resolve(candidate);
      return treeSitterState.wasmRuntimePath;
    } catch {
      // try next candidate
    }
  }
  throw new Error('web-tree-sitter WASM runtime not found');
}

export async function preflightTreeSitterWasmLanguages(languageIds = [], options = {}) {
  const unique = Array.from(new Set(languageIds || []));
  if (!unique.length) return { missing: [] };
  let wasmRoot = null;
  try {
    wasmRoot = resolveWasmRoot();
  } catch (err) {
    if (options?.log && !treeSitterState.loggedMissingWasm.has('wasm-root')) {
      options.log(`[tree-sitter] WASM root unavailable (${err?.message || err}).`);
      treeSitterState.loggedMissingWasm.add('wasm-root');
    }
    bumpMetric('wasmMissing', unique.length);
    return { missing: unique.slice() };
  }
  const missing = [];
  for (const id of unique) {
    const resolvedId = resolveLanguageId(id);
    if (!resolvedId) continue;
    const wasmFile = LANGUAGE_WASM_FILES[resolvedId];
    if (!wasmFile) {
      bumpMetric('wasmMissing', 1);
      if (options?.log && !treeSitterState.loggedMissingWasm.has(resolvedId)) {
        options.log(`[tree-sitter] Missing WASM mapping for ${resolvedId}.`);
        treeSitterState.loggedMissingWasm.add(resolvedId);
      }
      missing.push(resolvedId);
      continue;
    }
    const wasmPath = path.join(wasmRoot, wasmFile);
    try {
      await fs.access(wasmPath);
    } catch {
      bumpMetric('wasmMissing', 1);
      if (options?.log && !treeSitterState.loggedMissingWasm.has(resolvedId)) {
        options.log(`[tree-sitter] Missing WASM file for ${resolvedId} (${wasmFile}).`);
        treeSitterState.loggedMissingWasm.add(resolvedId);
      }
      missing.push(resolvedId);
    }
  }
  return { missing };
}

export async function initTreeSitterWasm(options = {}) {
  if (treeSitterState.TreeSitter || treeSitterState.treeSitterInitError) {
    return Boolean(treeSitterState.TreeSitter);
  }
  if (treeSitterState.treeSitterInitPromise) return treeSitterState.treeSitterInitPromise;
  treeSitterState.treeSitterInitPromise = (async () => {
    try {
      const mod = require('web-tree-sitter');
      treeSitterState.TreeSitter = mod?.Parser || mod;
      if (!treeSitterState.TreeSitter?.init) {
        throw new Error('web-tree-sitter Parser not available');
      }
      await treeSitterState.TreeSitter.init({
        locateFile: () => resolveRuntimePath()
      });
      treeSitterState.TreeSitterLanguage = mod?.Language || treeSitterState.TreeSitter?.Language || null;
      if (!treeSitterState.TreeSitterLanguage) {
        throw new Error('web-tree-sitter Language not available');
      }
      return true;
    } catch (err) {
      treeSitterState.treeSitterInitError = err;
      treeSitterState.TreeSitter = null;
      treeSitterState.TreeSitterLanguage = null;
      bumpMetric('wasmLoadFailures', 1);
      if (options?.log) {
        options.log(`[tree-sitter] WASM init failed: ${err?.message || err}.`);
      }
      return false;
    }
  })();
  return treeSitterState.treeSitterInitPromise;
}

async function loadWasmLanguage(languageId, options = {}) {
  const resolvedId = resolveLanguageId(languageId);
  if (!resolvedId) {
    return { language: null, error: new Error('Missing tree-sitter language id') };
  }

  const wasmFile = LANGUAGE_WASM_FILES[resolvedId];
  const wasmKey = wasmFile || null;

  const cached = treeSitterState.languageCache.get(resolvedId);
  if (cached?.language || cached?.error) {
    if (wasmKey) touchWasmLanguageCacheEntry(wasmKey);
    return cached;
  }

  if (!wasmFile) {
    const entry = { language: null, error: new Error(`Missing WASM file for ${resolvedId}`) };
    treeSitterState.languageCache.set(resolvedId, entry);
    bumpMetric('wasmMissing', 1);
    return entry;
  }

  // Deduplicate aliases that share the same wasm (e.g. javascript/jsx).
  const wasmCached = treeSitterState.wasmLanguageCache.get(wasmKey);
  if (wasmCached?.language || wasmCached?.error) {
    touchWasmLanguageCacheEntry(wasmKey);
    treeSitterState.languageCache.set(resolvedId, wasmCached);
    return wasmCached;
  }

  const pending = treeSitterState.languageLoadPromises.get(wasmKey);
  if (pending) {
    return pending.then((entry) => {
      if (entry && !treeSitterState.languageCache.has(resolvedId)) {
        treeSitterState.languageCache.set(resolvedId, entry);
      }
      touchWasmLanguageCacheEntry(wasmKey);
      return entry;
    });
  }

  const promise = (async () => {
    const ok = await initTreeSitterWasm(options);
    if (!ok) {
      const entry = {
        language: null,
        error: treeSitterState.treeSitterInitError || new Error('Tree-sitter WASM init failed')
      };
      treeSitterState.languageCache.set(resolvedId, entry);
      treeSitterState.wasmLanguageCache.set(wasmKey, entry);
      touchWasmLanguageCacheEntry(wasmKey);
      evictOldWasmLanguages(resolveMaxLoadedLanguages(options), options);
      bumpMetric('wasmLoadFailures', 1);
      return entry;
    }

    try {
      const wasmPath = path.join(resolveWasmRoot(), wasmFile);
      // Prefer path-based loading to avoid retaining large WASM buffers in JS.
      // (Some web-tree-sitter builds accept a file path.)
      let language;
      try {
        language = await treeSitterState.TreeSitterLanguage.load(wasmPath);
      } catch {
        const wasmBytes = await fs.readFile(wasmPath);
        language = await treeSitterState.TreeSitterLanguage.load(wasmBytes);
      }
      const entry = { language, error: null };
      treeSitterState.languageCache.set(resolvedId, entry);
      treeSitterState.wasmLanguageCache.set(wasmKey, entry);
      touchWasmLanguageCacheEntry(wasmKey);
      evictOldWasmLanguages(resolveMaxLoadedLanguages(options), options);
      bumpMetric('wasmLoads', 1);
      return entry;
    } catch (err) {
      const entry = { language: null, error: err };
      treeSitterState.languageCache.set(resolvedId, entry);
      treeSitterState.wasmLanguageCache.set(wasmKey, entry);
      touchWasmLanguageCacheEntry(wasmKey);
      evictOldWasmLanguages(resolveMaxLoadedLanguages(options), options);
      if (err?.code === 'ENOENT') {
        bumpMetric('wasmMissing', 1);
      } else {
        bumpMetric('wasmLoadFailures', 1);
      }
      return entry;
    } finally {
      treeSitterState.languageLoadPromises.delete(wasmKey);
    }
  })();

  treeSitterState.languageLoadPromises.set(wasmKey, promise);
  return promise;
}

export async function preloadTreeSitterLanguages(languageIds = TREE_SITTER_LANGUAGE_IDS, options = {}) {
  const ok = await initTreeSitterWasm(options);
  if (!ok) return false;

  const unique = Array.from(new Set(languageIds || []));

  const maxLoaded = resolveMaxLoadedLanguages(options);
  if (options?.log && maxLoaded && unique.length > maxLoaded && treeSitterState.loggedEvictionWarnings) {
    const key = `preload:${unique.length}:${maxLoaded}`;
    if (!treeSitterState.loggedEvictionWarnings.has(key)) {
      options.log(
        `[tree-sitter] Preloading ${unique.length} grammars with maxLoadedLanguages=${maxLoaded}; `
          + 'older grammars may be evicted during preload.'
      );
      treeSitterState.loggedEvictionWarnings.add(key);
    }
  }

  const parallel = options.parallel === true;
  const concurrency = Number.isFinite(Number(options.concurrency))
    ? Math.max(1, Math.floor(Number(options.concurrency)))
    : unique.length;

  if (!parallel || concurrency <= 1) {
    for (const id of unique) {
      // Load sequentially to avoid wasm runtime contention.
      await loadWasmLanguage(id, options);
    }
    return true;
  }

  const pending = new Set();
  for (const id of unique) {
    const task = loadWasmLanguage(id, options)
      .finally(() => pending.delete(task));
    pending.add(task);
    if (pending.size >= concurrency) {
      await Promise.race(pending);
    }
  }
  await Promise.all(pending);
  return true;
}

export function pruneTreeSitterLanguages(keepLanguages = [], options = {}) {
  if (!treeSitterState.TreeSitter) return { removed: 0, kept: 0 };
  const maxLoaded = Number(options?.maxLoadedLanguages);
  const cacheSize = treeSitterState.wasmLanguageCache.size;
  if (options?.onlyIfExceeds && Number.isFinite(maxLoaded) && maxLoaded > 0 && cacheSize <= maxLoaded) {
    return { removed: 0, kept: cacheSize };
  }
  const keepIds = new Set();
  for (const id of keepLanguages || []) {
    const resolved = resolveLanguageId(id);
    if (resolved) keepIds.add(resolved);
  }
  const activeLangId = treeSitterState.sharedParserLanguageId;
  if (activeLangId) keepIds.add(activeLangId);

  const keepWasmKeys = new Set();
  for (const langId of keepIds) {
    const wasmKey = LANGUAGE_WASM_FILES[langId];
    if (wasmKey) keepWasmKeys.add(wasmKey);
  }

  for (const langId of treeSitterState.languageCache.keys()) {
    const wasmKey = LANGUAGE_WASM_FILES[langId];
    if (!wasmKey || !keepWasmKeys.has(wasmKey)) {
      treeSitterState.languageCache.delete(langId);
    }
  }

  let removed = 0;
  for (const [wasmKey, entry] of treeSitterState.wasmLanguageCache.entries()) {
    if (keepWasmKeys.has(wasmKey)) continue;
    treeSitterState.wasmLanguageCache.delete(wasmKey);
    removeLanguageCacheEntriesForWasmKey(wasmKey);
    disposeWasmLanguageEntry(entry, options?.skipDispose === true);
    removed += 1;
  }

  if (options?.log && removed > 0) {
    options.log(`[tree-sitter] Pruned ${removed} WASM grammars from cache.`);
  }

  return { removed, kept: treeSitterState.wasmLanguageCache.size };
}

export function resetTreeSitterParser({ hard = false } = {}) {
  if (!treeSitterState.sharedParser) return;
  try {
    treeSitterState.sharedParser.reset?.();
  } catch {
    // ignore reset failures
  }
  if (hard) {
    try {
      treeSitterState.sharedParser.delete?.();
    } catch {
      // ignore delete failures
    }
    treeSitterState.sharedParser = null;
    treeSitterState.sharedParserLanguageId = null;
  }
}
function touchParserCacheEntry(languageId) {
  // Map iteration order is insertion order; re-insert to mark as most-recently-used.
  if (!treeSitterState.parserCache.has(languageId)) return;
  const value = treeSitterState.parserCache.get(languageId);
  treeSitterState.parserCache.delete(languageId);
  treeSitterState.parserCache.set(languageId, value);
}

function evictOldParsers(maxSize = DEFAULT_MAX_PARSER_CACHE) {
  if (!Number.isFinite(Number(maxSize)) || maxSize <= 0) return;
  while (treeSitterState.parserCache.size > maxSize) {
    const oldestKey = treeSitterState.parserCache.keys().next().value;
    const oldestParser = treeSitterState.parserCache.get(oldestKey);
    treeSitterState.parserCache.delete(oldestKey);
    if (oldestParser && typeof oldestParser.delete === 'function') {
      try {
        oldestParser.delete();
      } catch {
        // ignore
      }
    }
  }
}

export function getTreeSitterParser(languageId, options = {}) {
  if (!treeSitterState.TreeSitter) {
    const resolvedId = resolveLanguageId(languageId);
    if (resolvedId && !treeSitterState.loggedInitFailure.has(resolvedId) && options?.log) {
      const reason = treeSitterState.treeSitterInitError?.message || 'WASM runtime not initialized';
      options.log(`[tree-sitter] WASM runtime unavailable for ${resolvedId} (${reason}).`);
      treeSitterState.loggedInitFailure.add(resolvedId);
    }
    return null;
  }

  const resolvedId = resolveLanguageId(languageId);
  if (!resolvedId) return null;

  const entry = treeSitterState.languageCache.get(resolvedId) || null;
  const language = entry?.language || null;
  if (!language) {
    const suppressMissingLog = options?.suppressMissingLog === true
      || options?.treeSitter?.deferMissing === true;
    if (!suppressMissingLog && !treeSitterState.loggedMissing.has(resolvedId)) {
      const reason = entry?.error?.message || 'WASM grammar not loaded';
      if (options?.log) {
        options.log(`[tree-sitter] Missing WASM grammar for ${resolvedId} (${reason}).`);
      } else {
        console.warn(`[tree-sitter] Missing WASM grammar for ${resolvedId} (${reason}).`);
      }
      treeSitterState.loggedMissing.add(resolvedId);
    }
    return null;
  }

  // Keep grammar LRU fresh.
  const wasmKey = LANGUAGE_WASM_FILES[resolvedId];
  if (wasmKey) touchWasmLanguageCacheEntry(wasmKey);

  // IMPORTANT: Keep a single shared Parser instance and switch languages.
  // Keeping multiple parsers alive (even with an LRU cache) can balloon WASM
  // memory in polyglot repos and trigger V8 "Zone" OOMs on Windows.
  try {
    if (!treeSitterState.sharedParser) {
      treeSitterState.sharedParser = new treeSitterState.TreeSitter();
      treeSitterState.sharedParserLanguageId = null;

      // Clear and dispose the legacy per-language cache to avoid keeping extra Parsers alive.
      if (treeSitterState.parserCache && typeof treeSitterState.parserCache.values === 'function') {
        for (const cached of treeSitterState.parserCache.values()) {
          if (cached && typeof cached.delete === 'function') {
            try {
              cached.delete();
            } catch {
              // ignore
            }
          }
        }
        treeSitterState.parserCache.clear();
      }
    }

    if (treeSitterState.sharedParserLanguageId !== resolvedId) {
      try {
        treeSitterState.sharedParser.reset?.();
      } catch {
        // ignore
      }
      treeSitterState.sharedParser.setLanguage(language);
      treeSitterState.sharedParserLanguageId = resolvedId;
      bumpMetric('parserActivations', 1);
    }

    return treeSitterState.sharedParser;
  } catch (err) {
    // If the shared parser becomes unusable, drop it and try to recreate on the next call.
    try {
      treeSitterState.sharedParser?.delete?.();
    } catch {
      // ignore
    }
    treeSitterState.sharedParser = null;
    treeSitterState.sharedParserLanguageId = null;

    const suppressMissingLog = options?.suppressMissingLog === true
      || options?.treeSitter?.deferMissing === true;
    if (!suppressMissingLog && !treeSitterState.loggedMissing.has(resolvedId)) {
      const message = err?.message || String(err);
      const log = options?.log || console.warn;
      log(`[tree-sitter] Failed to activate ${resolvedId} WASM grammar: ${message}.`);
      treeSitterState.loggedMissing.add(resolvedId);
    }
    return null;
  }
}

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { LANGUAGE_WASM_FILES, TREE_SITTER_LANGUAGE_IDS } from './config.js';
import { treeSitterState } from './state.js';

const require = createRequire(import.meta.url);

// Tree-sitter Parser instances can hold non-trivial native/WASM memory.
// In multi-language repos this can balloon quickly if we cache one Parser per
// language indefinitely. We cap the parser cache and evict LRU entries.
const DEFAULT_MAX_PARSER_CACHE = (() => {
  try {
    const envRaw = process.env.POC_TREE_SITTER_MAX_PARSERS;
    const envMax = Number(envRaw);
    if (Number.isFinite(envMax) && envMax > 0) {
      return Math.max(1, Math.min(16, Math.floor(envMax)));
    }

    const cpuCount = Array.isArray(os.cpus?.()) ? os.cpus().length : 0;
    // Keep this intentionally small; we only parse on the main thread.
    return Math.max(2, Math.min(4, cpuCount || 4));
  } catch {
    return 4;
  }
})();

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
  if (!resolvedId) return { language: null, error: new Error('invalid language id') };
  const cached = treeSitterState.languageCache.get(resolvedId);
  if (cached?.language || cached?.error) return cached;
  const pending = treeSitterState.languageLoadPromises.get(resolvedId);
  if (pending) return pending;
  const promise = (async () => {
    const ok = await initTreeSitterWasm(options);
    if (!ok) {
      return { language: null, error: treeSitterState.treeSitterInitError || new Error('Tree-sitter WASM init failed') };
    }
    const wasmFile = LANGUAGE_WASM_FILES[resolvedId];
    if (!wasmFile) {
      return { language: null, error: new Error(`Missing WASM file for ${resolvedId}`) };
    }
    try {
      const wasmPath = path.join(resolveWasmRoot(), wasmFile);
      const wasmBytes = await fs.readFile(wasmPath);
      const language = await treeSitterState.TreeSitterLanguage.load(wasmBytes);
      const entry = { language, error: null };
      treeSitterState.languageCache.set(resolvedId, entry);
      return entry;
    } catch (err) {
      const entry = { language: null, error: err };
      treeSitterState.languageCache.set(resolvedId, entry);
      return entry;
    } finally {
      treeSitterState.languageLoadPromises.delete(resolvedId);
    }
  })();
  treeSitterState.languageLoadPromises.set(resolvedId, promise);
  return promise;
}

export async function preloadTreeSitterLanguages(languageIds = TREE_SITTER_LANGUAGE_IDS, options = {}) {
  const ok = await initTreeSitterWasm(options);
  if (!ok) return false;
  const unique = Array.from(new Set(languageIds || []));
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
  if (treeSitterState.parserCache.has(resolvedId)) {
    touchParserCacheEntry(resolvedId);
    return treeSitterState.parserCache.get(resolvedId);
  }
  const entry = treeSitterState.languageCache.get(resolvedId) || null;
  const language = entry?.language || null;
  if (!language) {
    if (!treeSitterState.loggedMissing.has(resolvedId)) {
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
  const parser = new treeSitterState.TreeSitter();
  try {
    parser.setLanguage(language);
  } catch (err) {
    if (typeof parser.delete === 'function') {
      try {
        parser.delete();
      } catch {
        // ignore
      }
    }
    treeSitterState.parserCache.set(resolvedId, null);
    if (!treeSitterState.loggedMissing.has(resolvedId)) {
      const message = err?.message || err;
      const log = options?.log || console.warn;
      log(`[tree-sitter] Failed to load ${resolvedId} WASM grammar: ${message}.`);
      treeSitterState.loggedMissing.add(resolvedId);
    }
    evictOldParsers();
    return null;
  }
  treeSitterState.parserCache.set(resolvedId, parser);
  evictOldParsers();
  return parser;
}

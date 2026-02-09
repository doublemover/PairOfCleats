import { TREE_SITTER_LANGUAGE_IDS } from './config.js';
import {
  getNativeTreeSitterParser,
  hasNativeTreeSitterGrammar,
  initNativeTreeSitter,
  preflightNativeTreeSitterGrammars
} from './native-runtime.js';
import { treeSitterState } from './state.js';

const runtimeState = {
  activeLanguageId: null,
  activatedLanguages: new Set(),
  loggedMissing: new Set(),
  loggedInitFailure: false
};

const bumpMetric = (key, amount = 1) => {
  if (!key) return;
  const metrics = treeSitterState.metrics;
  if (!metrics || typeof metrics !== 'object') return;
  const current = Number.isFinite(metrics[key]) ? metrics[key] : 0;
  metrics[key] = current + amount;
};

const normalizeLanguageIds = (languageIds) => {
  if (!Array.isArray(languageIds)) return [];
  const unique = new Set();
  for (const languageId of languageIds) {
    if (typeof languageId !== 'string') continue;
    const value = languageId.trim();
    if (!value) continue;
    unique.add(value);
  }
  return Array.from(unique);
};

const logOnce = (bucket, key, log, message) => {
  if (!log || !bucket || !key) return;
  if (bucket.has(key)) return;
  bucket.add(key);
  log(message);
};

const cloneMetrics = () => {
  const metrics = treeSitterState.metrics || {};
  return Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, Number(value) || 0]));
};

export function getTreeSitterCacheSnapshot() {
  return {
    parserLanguage: runtimeState.activeLanguageId,
    loadedLanguages: Array.from(runtimeState.activatedLanguages).sort(),
    caches: {
      queryCache: treeSitterState.queryCache?.size || 0,
      chunkCache: treeSitterState.chunkCache?.size || 0
    }
  };
}

export async function preflightTreeSitterWasmLanguages(languageIds = [], options = {}) {
  const unique = normalizeLanguageIds(languageIds);
  const preflight = preflightNativeTreeSitterGrammars(unique, { log: options?.log });
  return {
    ok: preflight.ok,
    missing: Array.isArray(preflight.missing) ? preflight.missing : [],
    unavailable: Array.isArray(preflight.unavailable) ? preflight.unavailable : []
  };
}

export async function initTreeSitterWasm(options = {}) {
  const ok = initNativeTreeSitter({ log: options?.log });
  if (!ok) {
    if (!treeSitterState.treeSitterInitError) {
      treeSitterState.treeSitterInitError = new Error('Native tree-sitter runtime unavailable.');
    }
    logOnce(
      treeSitterState.loggedInitFailure,
      'native-init-failed',
      options?.log,
      '[tree-sitter] Native parser runtime unavailable.'
    );
  }
  return ok;
}

export async function preloadTreeSitterLanguages(languageIds = TREE_SITTER_LANGUAGE_IDS, options = {}) {
  const unique = normalizeLanguageIds(languageIds);
  const loaded = [];
  const missing = [];
  const failures = [];

  if (!unique.length) {
    return { loaded, missing, failures };
  }

  const ok = await initTreeSitterWasm(options);
  if (!ok) {
    failures.push(...unique);
    return { loaded, missing, failures };
  }

  for (const languageId of unique) {
    if (!hasNativeTreeSitterGrammar(languageId)) {
      missing.push(languageId);
      bumpMetric('fallbacks', 1);
      continue;
    }
    const parser = getNativeTreeSitterParser(languageId, options);
    if (!parser) {
      failures.push(languageId);
      bumpMetric('fallbacks', 1);
      continue;
    }
    runtimeState.activatedLanguages.add(languageId);
    loaded.push(languageId);
  }

  return { loaded, missing, failures };
}

export function pruneTreeSitterLanguages(keepLanguages = [], options = {}) {
  const keep = new Set(normalizeLanguageIds(keepLanguages));
  const current = Array.from(runtimeState.activatedLanguages);
  runtimeState.activatedLanguages.clear();
  for (const languageId of current) {
    if (keep.size === 0 || keep.has(languageId)) {
      runtimeState.activatedLanguages.add(languageId);
    }
  }
  if (runtimeState.activeLanguageId && keep.size > 0 && !keep.has(runtimeState.activeLanguageId)) {
    runtimeState.activeLanguageId = null;
  }
  if (options?.log) {
    logOnce(
      treeSitterState.loggedEvictionWarnings,
      'native-prune-noop',
      options.log,
      '[tree-sitter] Native runtime does not unload grammars; prune is treated as a no-op.'
    );
  }
  return { removed: 0, kept: runtimeState.activatedLanguages.size };
}

export function resetTreeSitterParser({ hard = false } = {}) {
  if (hard) {
    runtimeState.activeLanguageId = null;
  }
}

export function getTreeSitterParser(languageId, options = {}) {
  const resolvedId = typeof languageId === 'string' ? languageId.trim() : '';
  if (!resolvedId) return null;

  if (!hasNativeTreeSitterGrammar(resolvedId)) {
    bumpMetric('fallbacks', 1);
    if (!options?.suppressMissingLog) {
      logOnce(
        runtimeState.loggedMissing,
        resolvedId,
        options?.log,
        `[tree-sitter] Missing native grammar for ${resolvedId}.`
      );
    }
    return null;
  }

  const parser = getNativeTreeSitterParser(resolvedId, options);
  if (!parser) {
    bumpMetric('fallbacks', 1);
    if (!options?.suppressMissingLog) {
      logOnce(
        runtimeState.loggedMissing,
        `${resolvedId}:unavailable`,
        options?.log,
        `[tree-sitter] Native parser unavailable for ${resolvedId}.`
      );
    }
    return null;
  }

  if (runtimeState.activeLanguageId !== resolvedId) {
    runtimeState.activeLanguageId = resolvedId;
    bumpMetric('parserActivations', 1);
  }
  runtimeState.activatedLanguages.add(resolvedId);

  return parser;
}

export function getTreeSitterStats() {
  return cloneMetrics();
}

export function resetTreeSitterStats() {
  const metrics = treeSitterState.metrics || {};
  for (const key of Object.keys(metrics)) {
    if (typeof metrics[key] === 'number') {
      metrics[key] = 0;
    }
  }
  treeSitterState.timeoutCounts?.clear?.();
  treeSitterState.disabledLanguages?.clear?.();
  treeSitterState.loggedTimeoutDisable?.clear?.();
  treeSitterState.loggedWorkerFailures?.clear?.();
  runtimeState.loggedMissing.clear();
}

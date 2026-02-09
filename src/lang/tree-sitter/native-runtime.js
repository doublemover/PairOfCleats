import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const nativeTreeSitterState = {
  ParserCtor: null,
  initError: null,
  initTried: false,
  grammarCache: new Map(), // languageId -> { language, error }
  sharedParser: null,
  sharedParserLanguageId: null,
  loggedMissing: new Set()
};

const formatMemoryUsage = () => {
  const usage = process.memoryUsage();
  const toMb = (value) => (Number(value) / (1024 * 1024)).toFixed(1);
  return `rss=${toMb(usage.rss)}MB heapUsed=${toMb(usage.heapUsed)}MB ext=${toMb(usage.external)}MB ab=${toMb(usage.arrayBuffers)}MB`;
};

const NATIVE_GRAMMAR_MODULES = Object.freeze({
  javascript: { moduleName: 'tree-sitter-javascript' },
  typescript: { moduleName: 'tree-sitter-typescript', exportKey: 'typescript' },
  tsx: { moduleName: 'tree-sitter-typescript', exportKey: 'tsx' },
  python: { moduleName: 'tree-sitter-python' },
  json: { moduleName: 'tree-sitter-json' },
  yaml: { moduleName: '@tree-sitter-grammars/tree-sitter-yaml' },
  toml: { moduleName: '@tree-sitter-grammars/tree-sitter-toml' },
  markdown: { moduleName: '@tree-sitter-grammars/tree-sitter-markdown' },
  swift: { moduleName: 'tree-sitter-swift' }
});

const resolveGrammarModule = (languageId) => NATIVE_GRAMMAR_MODULES[languageId] || null;

export function hasNativeTreeSitterGrammar(languageId) {
  return Boolean(resolveGrammarModule(languageId));
}

export function initNativeTreeSitter({ log } = {}) {
  if (nativeTreeSitterState.initTried) return nativeTreeSitterState.ParserCtor != null;
  nativeTreeSitterState.initTried = true;
  try {
    nativeTreeSitterState.ParserCtor = require('tree-sitter');
    if (log) log(`[tree-sitter:native] Parser ready mem=${formatMemoryUsage()}`);
    return true;
  } catch (err) {
    nativeTreeSitterState.initError = err;
    if (log) {
      const message = err?.message || String(err);
      log(`[tree-sitter:native] Parser unavailable (${message}).`);
    }
    return false;
  }
}

export function loadNativeTreeSitterGrammar(languageId, { log } = {}) {
  const cached = nativeTreeSitterState.grammarCache.get(languageId);
  if (cached) return cached;
  const grammarSpec = resolveGrammarModule(languageId);
  if (!grammarSpec) {
    const entry = { language: null, error: new Error(`Unsupported native grammar: ${languageId}`) };
    nativeTreeSitterState.grammarCache.set(languageId, entry);
    return entry;
  }
  const moduleName = grammarSpec.moduleName;
  try {
    const grammarModule = require(moduleName);
    const language = grammarSpec.exportKey
      ? grammarModule?.[grammarSpec.exportKey] || null
      : grammarModule;
    if (!language) throw new Error(`Missing export "${grammarSpec.exportKey}" in ${moduleName}`);
    const entry = { language, error: null };
    nativeTreeSitterState.grammarCache.set(languageId, entry);
    if (log) log(`[tree-sitter:native] Loaded ${moduleName} for ${languageId} mem=${formatMemoryUsage()}`);
    return entry;
  } catch (err) {
    const entry = { language: null, error: err };
    nativeTreeSitterState.grammarCache.set(languageId, entry);
    if (log && !nativeTreeSitterState.loggedMissing.has(languageId)) {
      const message = err?.message || String(err);
      log(`[tree-sitter:native] Missing grammar for ${languageId} (${moduleName}): ${message}`);
      nativeTreeSitterState.loggedMissing.add(languageId);
    }
    return entry;
  }
}

export function getNativeTreeSitterParser(languageId, options = {}) {
  const resolvedId = typeof languageId === 'string' ? languageId : null;
  if (!resolvedId) return null;
  const log = options?.log || null;
  if (!initNativeTreeSitter({ log })) return null;
  const { language } = loadNativeTreeSitterGrammar(resolvedId, { log });
  if (!language) return null;

  try {
    if (!nativeTreeSitterState.sharedParser) {
      nativeTreeSitterState.sharedParser = new nativeTreeSitterState.ParserCtor();
      nativeTreeSitterState.sharedParserLanguageId = null;
    }

    if (nativeTreeSitterState.sharedParserLanguageId !== resolvedId) {
      // Native tree-sitter doesn't expose a documented `reset()`; treat language
      // switches as the synchronization point.
      nativeTreeSitterState.sharedParser.setLanguage(language);
      nativeTreeSitterState.sharedParserLanguageId = resolvedId;
      if (log) log(`[tree-sitter:native] Activated ${resolvedId} mem=${formatMemoryUsage()}`);
    }

    return nativeTreeSitterState.sharedParser;
  } catch (err) {
    try {
      nativeTreeSitterState.sharedParser?.delete?.();
    } catch {}
    nativeTreeSitterState.sharedParser = null;
    nativeTreeSitterState.sharedParserLanguageId = null;
    if (log) {
      const message = err?.message || String(err);
      log(`[tree-sitter:native] Failed to activate ${resolvedId}: ${message}`);
    }
    return null;
  }
}

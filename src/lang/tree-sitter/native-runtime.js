import { loadGrammarModule, resolveGrammarLanguageExport, normalizeLanguageBinding } from './native-grammar-binding.js';
import { createRequire } from 'node:module';
import path from 'node:path';
import { LANGUAGE_GRAMMAR_KEYS } from './config.js';
import { toStringArray } from '../../shared/iterables.js';
import { fingerprintLoadedNativeArtifact } from './native-artifact-identity.js';

const require = createRequire(import.meta.url);

const nativeTreeSitterState = {
  ParserCtor: null,
  parserIdentity: null,
  parserIdentityTried: false,
  parserIdentityFailure: null,
  initError: null,
  initTried: false,
  grammarCache: new Map(), // languageId -> { language, error }
  parserCache: new Map(), // languageId -> parser instance
  parserLru: [],
  loggedMissing: new Set()
};
const DEFAULT_PARSER_CACHE_SIZE = 4;
const MAX_PARSER_CACHE_SIZE = 64;

export const NATIVE_GRAMMAR_MODULES = Object.freeze({
  javascript: {
    moduleName: 'tree-sitter-javascript',
    exportKey: 'javascript',
    fallbackExportKeys: ['language']
  },
  jsx: {
    moduleName: 'tree-sitter-javascript',
    exportKey: 'jsx',
    fallbackExportKeys: ['language']
  },
  typescript: { moduleName: 'tree-sitter-typescript', exportKey: 'typescript' },
  tsx: { moduleName: 'tree-sitter-typescript', exportKey: 'tsx' },
  python: { moduleName: 'tree-sitter-python' },
  json: { moduleName: 'tree-sitter-json' },
  yaml: {
    moduleName: '@tree-sitter-grammars/tree-sitter-yaml',
    fallbackExportKeys: ['yaml', 'language', 'default']
  },
  toml: {
    moduleName: '@tree-sitter-grammars/tree-sitter-toml',
    fallbackExportKeys: ['toml', 'language', 'default']
  },
  xml: {
    moduleName: '@tree-sitter-grammars/tree-sitter-xml',
    fallbackExportKeys: ['xml', 'language', 'default']
  },
  markdown: {
    moduleName: '@tree-sitter-grammars/tree-sitter-markdown',
    fallbackExportKeys: ['markdown', 'language', 'default']
  },
  kotlin: { moduleName: 'tree-sitter-kotlin' },
  csharp: { moduleName: 'tree-sitter-c-sharp', nodeGypBinding: true },
  clike: { moduleName: 'tree-sitter-c' },
  c: { moduleName: 'tree-sitter-c' },
  cpp: { moduleName: 'tree-sitter-cpp' },
  objc: { moduleName: 'tree-sitter-objc' },
  go: { moduleName: 'tree-sitter-go' },
  rust: { moduleName: 'tree-sitter-rust' },
  java: { moduleName: 'tree-sitter-java' },
  dart: {
    moduleName: '@sengac/tree-sitter-dart',
    fallbackExportKeys: ['dart', 'language', 'default']
  },
  scala: {
    moduleName: 'tree-sitter-scala',
    fallbackExportKeys: ['scala', 'language', 'default']
  },
  groovy: {
    moduleName: 'tree-sitter-groovy',
    fallbackExportKeys: ['groovy', 'language', 'default']
  },
  r: {
    moduleName: '@eagleoutice/tree-sitter-r',
    fallbackExportKeys: ['r', 'language', 'default']
  },
  julia: {
    moduleName: 'tree-sitter-julia',
    fallbackExportKeys: ['julia', 'language', 'default']
  },
  ruby: {
    moduleName: 'tree-sitter-ruby',
    fallbackExportKeys: ['ruby', 'language', 'default']
  },
  php: {
    moduleName: 'tree-sitter-php',
    exportKey: 'php',
    fallbackExportKeys: ['php', 'php_only', 'language', 'default']
  },
  perl: {
    moduleName: '@ganezdragon/tree-sitter-perl',
    fallbackExportKeys: ['perl', 'language', 'default']
  },
  shell: {
    moduleName: 'tree-sitter-bash',
    exportKey: 'bash',
    fallbackExportKeys: ['bash', 'language', 'default']
  },
  sql: {
    moduleName: '@derekstride/tree-sitter-sql',
    fallbackExportKeys: ['sql', 'language', 'default']
  },
  css: { moduleName: 'tree-sitter-css', prebuildBinary: 'tree-sitter-css.node' },
  html: { moduleName: 'tree-sitter-html' },
  lua: {
    moduleName: '@tree-sitter-grammars/tree-sitter-lua',
    prebuildBinary: '@tree-sitter-grammars+tree-sitter-lua.node',
    fallbackExportKeys: ['lua', 'language', 'default']
  },
  swift: { moduleName: 'tree-sitter-swift' }
});

export const listNativeTreeSitterGrammarModuleNames = () => (
  Array.from(new Set(
    Object.values(NATIVE_GRAMMAR_MODULES)
      .map((spec) => (typeof spec?.moduleName === 'string' ? spec.moduleName : null))
      .filter(Boolean)
  )).sort()
);

const resolveGrammarModule = (languageId) => NATIVE_GRAMMAR_MODULES[languageId] || null;

const resolveParserCacheSize = (options = {}) => {
  const fromOptions = Number(options?.nativeParserCacheSize);
  const fromTreeSitter = Number(options?.treeSitter?.nativeParserCacheSize);
  const requested = Number.isFinite(fromOptions)
    ? fromOptions
    : (Number.isFinite(fromTreeSitter) ? fromTreeSitter : DEFAULT_PARSER_CACHE_SIZE);
  const normalized = Math.floor(requested);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return DEFAULT_PARSER_CACHE_SIZE;
  }
  return Math.min(MAX_PARSER_CACHE_SIZE, normalized);
};

export function hasNativeTreeSitterGrammar(languageId) {
  return Boolean(resolveGrammarModule(languageId));
}

export function resolveNativeTreeSitterTarget(languageId, ext = null) {
  const resolvedId = typeof languageId === 'string' ? languageId : null;
  if (!resolvedId) return null;
  if (!hasNativeTreeSitterGrammar(resolvedId)) return null;
  const grammarKey = LANGUAGE_GRAMMAR_KEYS?.[resolvedId] || `native:${resolvedId}`;
  return {
    languageId: resolvedId,
    grammarKey,
    runtimeKind: 'native',
    ext: typeof ext === 'string' && ext ? ext : null
  };
}

export function initNativeTreeSitter({ log } = {}) {
  if (nativeTreeSitterState.initTried) return nativeTreeSitterState.ParserCtor != null;
  nativeTreeSitterState.initTried = true;
  try {
    nativeTreeSitterState.ParserCtor = require('tree-sitter');
    return true;
  } catch (err) {
    nativeTreeSitterState.initError = err;
    if (log) {
      const message = err?.message || String(err);
      log(`[tree-sitter] Parser unavailable (${message}).`);
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
    const grammarModule = loadGrammarModule(grammarSpec, require);
    const resolved = resolveGrammarLanguageExport(grammarModule, grammarSpec);
    const language = normalizeLanguageBinding(resolved.language, grammarModule);
    if (!language) throw new Error(`Missing export "${resolved.source || 'module'}" in ${moduleName}`);
    const entry = { language, error: null, identity: null, identityTried: false, identityFailure: null, exportSource: resolved.source };
    nativeTreeSitterState.grammarCache.set(languageId, entry);
    return entry;
  } catch (err) {
    const entry = { language: null, error: err };
    nativeTreeSitterState.grammarCache.set(languageId, entry);
    if (log && !nativeTreeSitterState.loggedMissing.has(languageId)) {
      const message = err?.message || String(err);
      log(`[tree-sitter] Missing grammar for ${languageId} (${moduleName}): ${message}`);
      nativeTreeSitterState.loggedMissing.add(languageId);
    }
    return entry;
  }
}

export function preflightNativeTreeSitterGrammars(languageIds = [], { log } = {}) {
  const unique = Array.from(new Set(toStringArray(languageIds)));
  const missing = [];
  const unavailable = [];
  if (!unique.length) return { ok: true, missing, unavailable };
  const supported = [];
  for (const languageId of unique) {
    if (!resolveNativeTreeSitterTarget(languageId)) {
      missing.push(languageId);
      continue;
    }
    supported.push(languageId);
  }
  if (!supported.length) {
    return { ok: false, missing, unavailable };
  }
  const ready = initNativeTreeSitter({ log });
  if (!ready) {
    unavailable.push(...supported);
    return { ok: false, missing, unavailable };
  }
  for (const languageId of supported) {
    const loaded = loadNativeTreeSitterGrammar(languageId, { log });
    if (!loaded?.language) {
      unavailable.push(languageId);
      continue;
    }
    // Validate parser activation during preflight so invalid native bindings are
    // excluded from scheduler plans before execution starts.
    const parser = getNativeTreeSitterParser(languageId, { log });
    if (!parser) {
      unavailable.push(languageId);
    }
  }
  return {
    ok: missing.length === 0 && unavailable.length === 0,
    missing,
    unavailable
  };
}

export function getNativeTreeSitterParser(languageId, options = {}) {
  const resolvedId = typeof languageId === 'string' ? languageId : null;
  if (!resolvedId) return null;
  const log = options?.log || null;
  if (!initNativeTreeSitter({ log })) return null;
  const { language } = loadNativeTreeSitterGrammar(resolvedId, { log });
  if (!language) return null;

  try {
    const cached = nativeTreeSitterState.parserCache.get(resolvedId);
    if (cached) {
      nativeTreeSitterState.parserLru = nativeTreeSitterState.parserLru.filter((id) => id !== resolvedId);
      nativeTreeSitterState.parserLru.push(resolvedId);
      return cached;
    }
    const parser = new nativeTreeSitterState.ParserCtor();
    parser.setLanguage(language);
    nativeTreeSitterState.parserCache.set(resolvedId, parser);
    nativeTreeSitterState.parserLru.push(resolvedId);
    const parserCacheSize = resolveParserCacheSize(options);
    while (nativeTreeSitterState.parserLru.length > parserCacheSize) {
      const evictedId = nativeTreeSitterState.parserLru.shift();
      if (!evictedId) continue;
      const evictedParser = nativeTreeSitterState.parserCache.get(evictedId);
      nativeTreeSitterState.parserCache.delete(evictedId);
      try {
        evictedParser?.delete?.();
      } catch {}
    }
    return parser;
  } catch (err) {
    const parser = nativeTreeSitterState.parserCache.get(resolvedId);
    nativeTreeSitterState.parserCache.delete(resolvedId);
    nativeTreeSitterState.parserLru = nativeTreeSitterState.parserLru.filter((id) => id !== resolvedId);
    try { parser?.delete?.(); } catch {}
    if (log) {
      const message = err?.message || String(err);
      log(`[tree-sitter] Failed to activate ${resolvedId}: ${message}`);
    }
    return null;
  }
}

/** Portable data identity only; no parser, language, tree or node escapes. */
export const getNativeTreeSitterIdentity = languageId => {
  const grammar = nativeTreeSitterState.grammarCache.get(languageId);
  if (!nativeTreeSitterState.ParserCtor || !grammar?.language) return null;
  if (nativeTreeSitterState.parserIdentityFailure) throw nativeTreeSitterState.parserIdentityFailure;
  if (grammar.identityFailure) throw grammar.identityFailure;
  if (!nativeTreeSitterState.parserIdentityTried) {
    nativeTreeSitterState.parserIdentityTried = true;
    try {
      nativeTreeSitterState.parserIdentity = fingerprintLoadedNativeArtifact({ require,
        value: nativeTreeSitterState.ParserCtor, moduleName: 'tree-sitter', exportKey: 'Parser' });
    } catch (error) { nativeTreeSitterState.parserIdentityFailure = error; throw error; }
  }
  if (!grammar.identityTried) {
    grammar.identityTried = true;
    try {
      grammar.identity = fingerprintLoadedNativeArtifact({ require, value: grammar.language,
        moduleName: resolveGrammarModule(languageId).moduleName, exportKey: grammar.exportSource });
    } catch (error) { grammar.identityFailure = error; throw error; }
  }
  if (!nativeTreeSitterState.parserIdentity || !grammar?.identity || !grammar.language) return null;
  return Object.freeze({ version: 1, runtimeKind: 'native-tree-sitter', languageId,
    grammarKey: LANGUAGE_GRAMMAR_KEYS[languageId] || 'native:' + languageId,
    parserArtifact: nativeTreeSitterState.parserIdentity, grammarArtifact: grammar.identity,
    grammarExport: grammar.exportSource || 'module', node: process.versions.node,
    abi: process.versions.modules, platform: process.platform, arch: process.arch });
};

export function warmupNativeTreeSitterParsers(languageIds = [], options = {}) {
  const unique = Array.from(new Set(toStringArray(languageIds)));
  if (!unique.length) {
    return { warmed: [], failed: [] };
  }
  const warmed = [];
  const failed = [];
  for (const languageId of unique) {
    const parser = getNativeTreeSitterParser(languageId, options);
    if (parser) warmed.push(languageId);
    else failed.push(languageId);
  }
  return { warmed, failed };
}

import { createRequire } from 'node:module';
import { LANGUAGE_GRAMMAR_KEYS } from './config.js';

const require = createRequire(import.meta.url);

const nativeTreeSitterState = {
  ParserCtor: null,
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
  csharp: { moduleName: 'tree-sitter-c-sharp' },
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
    moduleName: 'tree-sitter-lua',
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

const resolveGrammarLanguageExport = (grammarModule, grammarSpec) => {
  const preferredKey = typeof grammarSpec?.exportKey === 'string' && grammarSpec.exportKey
    ? grammarSpec.exportKey
    : null;
  if (preferredKey && grammarModule?.[preferredKey]) {
    return { language: grammarModule[preferredKey], source: preferredKey };
  }

  const fallbackKeys = Array.isArray(grammarSpec?.fallbackExportKeys)
    ? grammarSpec.fallbackExportKeys
    : [];
  for (const key of fallbackKeys) {
    if (typeof key !== 'string' || !key) continue;
    if (grammarModule?.[key]) {
      return { language: grammarModule[key], source: key };
    }
  }

  if (grammarModule?.default) {
    return { language: grammarModule.default, source: 'default' };
  }

  if (preferredKey && grammarModule && typeof grammarModule === 'object') {
    return { language: grammarModule, source: 'module' };
  }

  if (!preferredKey) {
    return { language: grammarModule, source: null };
  }
  return { language: null, source: preferredKey };
};

const normalizeLanguageBinding = (languageValue, grammarModule) => {
  if (languageValue?.default && languageValue.default !== languageValue) {
    const nested = normalizeLanguageBinding(languageValue.default, grammarModule);
    if (nested) return nested;
  }
  if (!languageValue || typeof languageValue !== 'object') return null;
  if (
    languageValue.nodeTypeInfo
    && (typeof languageValue.fieldIdForName === 'function' || typeof languageValue.name === 'string')
  ) {
    return languageValue;
  }
  if (languageValue.language && languageValue.nodeTypeInfo) return languageValue;
  if (grammarModule && grammarModule.nodeTypeInfo && languageValue === grammarModule.language) {
    return grammarModule;
  }
  return null;
};

const loadGrammarModule = (grammarSpec) => {
  if (grammarSpec?.prebuildBinary) {
    const prebuildId = `${process.platform}-${process.arch}`;
    const bindingPath = `${grammarSpec.moduleName}/prebuilds/${prebuildId}/${grammarSpec.prebuildBinary}`;
    try {
      const binding = require(bindingPath);
      try {
        binding.nodeTypeInfo = require(`${grammarSpec.moduleName}/src/node-types.json`);
      } catch {
        // ignore missing node-types metadata
      }
      return binding;
    } catch (prebuildErr) {
      try {
        return require(grammarSpec.moduleName);
      } catch (moduleErr) {
        if (moduleErr && typeof moduleErr === 'object' && moduleErr.cause == null) {
          moduleErr.cause = prebuildErr;
        }
        throw moduleErr;
      }
    }
  }
  return require(grammarSpec.moduleName);
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
    const grammarModule = loadGrammarModule(grammarSpec);
    const resolved = resolveGrammarLanguageExport(grammarModule, grammarSpec);
    const language = normalizeLanguageBinding(resolved.language, grammarModule);
    if (!language) throw new Error(`Missing export "${resolved.source || 'module'}" in ${moduleName}`);
    const entry = { language, error: null };
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
  const unique = Array.from(new Set((languageIds || []).filter((id) => typeof id === 'string' && id)));
  const missing = [];
  const unavailable = [];
  if (!unique.length) return { ok: true, missing, unavailable };
  const ready = initNativeTreeSitter({ log });
  if (!ready) {
    unavailable.push(...unique);
    return { ok: false, missing, unavailable };
  }
  for (const languageId of unique) {
    const target = resolveNativeTreeSitterTarget(languageId);
    if (!target) {
      missing.push(languageId);
      continue;
    }
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

export function warmupNativeTreeSitterParsers(languageIds = [], options = {}) {
  const unique = Array.from(new Set((languageIds || []).filter((id) => typeof id === 'string' && id)));
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

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { extractDocComment, sliceSignature } from './shared.js';

const require = createRequire(import.meta.url);
let TreeSitter = null;
let TreeSitterLanguage = null;
let treeSitterInitError = null;
let treeSitterInitPromise = null;
let wasmRoot = null;
let wasmRuntimePath = null;
const parserCache = new Map();
const languageCache = new Map();
const languageLoadPromises = new Map();
const loggedMissing = new Set();
const loggedInitFailure = new Set();
const loggedParseFailures = new Set();
const loggedParseTimeouts = new Set();
const loggedSizeSkips = new Set();
const loggedUnavailable = new Set();
const loggedWorkerFailures = new Set();
let treeSitterWorkerPool = null;
let treeSitterWorkerConfigSignature = null;

const LANGUAGE_WASM_FILES = {
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  jsx: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  json: 'tree-sitter-json.wasm',
  yaml: 'tree-sitter-yaml.wasm',
  toml: 'tree-sitter-toml.wasm',
  markdown: 'tree-sitter-markdown.wasm',
  swift: 'tree-sitter-swift.wasm',
  kotlin: 'tree-sitter-kotlin.wasm',
  csharp: 'tree-sitter-c_sharp.wasm',
  clike: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  objc: 'tree-sitter-objc.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  java: 'tree-sitter-java.wasm',
  css: 'tree-sitter-css.wasm',
  html: 'tree-sitter-html.wasm'
};

export const TREE_SITTER_LANGUAGE_IDS = Object.freeze(
  Object.keys(LANGUAGE_WASM_FILES)
);

const COMMON_NAME_NODE_TYPES = new Set([
  'identifier',
  'type_identifier',
  'scoped_identifier',
  'qualified_identifier',
  'field_identifier',
  'simple_identifier',
  'namespace_identifier'
]);

const getNamedChildCount = (node) => {
  if (!node) return 0;
  if (Number.isFinite(node.namedChildCount)) return node.namedChildCount;
  return Array.isArray(node.namedChildren) ? node.namedChildren.length : 0;
};

const getNamedChild = (node, index) => {
  if (!node) return null;
  if (typeof node.namedChild === 'function') return node.namedChild(index);
  if (Array.isArray(node.namedChildren)) return node.namedChildren[index] || null;
  return null;
};

function findDescendantByType(root, types, maxDepth = 6) {
  if (!root) return null;
  const stack = [{ node: root, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (!node) continue;
    if (types.has(node.type)) return node;
    if (depth >= maxDepth) continue;
    const count = getNamedChildCount(node);
    for (let i = count - 1; i >= 0; i -= 1) {
      stack.push({ node: getNamedChild(node, i), depth: depth + 1 });
    }
  }
  return null;
}

const JS_TS_CONFIG = {
  typeNodes: new Set([
    'class_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration'
  ]),
  memberNodes: new Set([
    'function_declaration',
    'method_definition',
    'function',
    'arrow_function'
  ]),
  kindMap: {
    class_declaration: 'ClassDeclaration',
    interface_declaration: 'InterfaceDeclaration',
    type_alias_declaration: 'TypeAlias',
    enum_declaration: 'EnumDeclaration',
    function_declaration: 'FunctionDeclaration',
    method_definition: 'MethodDeclaration',
    function: 'FunctionDeclaration',
    arrow_function: 'ArrowFunction'
  },
  docComments: { linePrefixes: ['//'], blockStarts: ['/**'] }
};

const LANG_CONFIG = {
  javascript: JS_TS_CONFIG,
  typescript: JS_TS_CONFIG,
  tsx: JS_TS_CONFIG,
  jsx: JS_TS_CONFIG,
  python: {
    typeNodes: new Set(['class_definition']),
    memberNodes: new Set(['function_definition']),
    kindMap: {
      class_definition: 'ClassDeclaration',
      function_definition: 'FunctionDeclaration'
    },
    docComments: { linePrefixes: ['#'] },
    nameFields: ['name']
  },
  json: {
    typeNodes: new Set(['pair']),
    memberNodes: new Set([]),
    kindMap: { pair: 'ConfigEntry' },
    nameFields: ['key']
  },
  yaml: {
    typeNodes: new Set(['block_mapping_pair', 'flow_pair']),
    memberNodes: new Set([]),
    kindMap: {
      block_mapping_pair: 'ConfigEntry',
      flow_pair: 'ConfigEntry'
    },
    nameFields: ['key'],
    docComments: { linePrefixes: ['#'] }
  },
  toml: {
    typeNodes: new Set(['pair']),
    memberNodes: new Set([]),
    kindMap: { pair: 'ConfigEntry' },
    nameFields: ['key']
  },
  markdown: {
    typeNodes: new Set(['atx_heading', 'setext_heading']),
    memberNodes: new Set([]),
    kindMap: {
      atx_heading: 'Section',
      setext_heading: 'Section'
    }
  },
  swift: {
    typeNodes: new Set([
      'class_declaration',
      'struct_declaration',
      'enum_declaration',
      'protocol_declaration',
      'extension_declaration',
      'actor_declaration'
    ]),
    memberNodes: new Set([
      'function_declaration',
      'initializer_declaration',
      'deinitializer_declaration',
      'subscript_declaration'
    ]),
    kindMap: {
      class_declaration: 'ClassDeclaration',
      struct_declaration: 'StructDeclaration',
      enum_declaration: 'EnumDeclaration',
      protocol_declaration: 'ProtocolDeclaration',
      extension_declaration: 'ExtensionDeclaration',
      actor_declaration: 'ActorDeclaration',
      function_declaration: 'FunctionDeclaration',
      initializer_declaration: 'Initializer',
      deinitializer_declaration: 'Deinitializer',
      subscript_declaration: 'SubscriptDeclaration'
    },
    docComments: { linePrefixes: ['///', '//'] },
    resolveKind: (node, kind, text) => {
      if (node.type !== 'class_declaration') return kind;
      const head = text.slice(node.startIndex, Math.min(text.length, node.startIndex + 40));
      const match = head.match(/^\s*(struct|class|extension)\b/);
      if (!match) return kind;
      if (match[1] === 'struct') return 'StructDeclaration';
      if (match[1] === 'extension') return 'ExtensionDeclaration';
      return kind;
    }
  },
  kotlin: {
    typeNodes: new Set([
      'class_declaration',
      'object_declaration',
      'interface_declaration',
      'enum_class_body'
    ]),
    memberNodes: new Set([
      'function_declaration',
      'secondary_constructor'
    ]),
    kindMap: {
      class_declaration: 'ClassDeclaration',
      object_declaration: 'ObjectDeclaration',
      interface_declaration: 'InterfaceDeclaration',
      enum_class_body: 'EnumDeclaration',
      function_declaration: 'FunctionDeclaration',
      secondary_constructor: 'ConstructorDeclaration'
    },
    docComments: { linePrefixes: ['//'], blockStarts: ['/**'] }
  },
  csharp: {
    typeNodes: new Set([
      'class_declaration',
      'struct_declaration',
      'interface_declaration',
      'enum_declaration',
      'record_declaration'
    ]),
    memberNodes: new Set([
      'method_declaration',
      'constructor_declaration',
      'property_declaration',
      'event_declaration'
    ]),
    kindMap: {
      class_declaration: 'ClassDeclaration',
      struct_declaration: 'StructDeclaration',
      interface_declaration: 'InterfaceDeclaration',
      enum_declaration: 'EnumDeclaration',
      record_declaration: 'RecordDeclaration',
      method_declaration: 'MethodDeclaration',
      constructor_declaration: 'ConstructorDeclaration',
      property_declaration: 'PropertyDeclaration',
      event_declaration: 'EventDeclaration'
    },
    docComments: { linePrefixes: ['///', '//'] }
  },
  clike: {
    typeNodes: new Set([
      'struct_specifier',
      'class_specifier',
      'enum_specifier',
      'union_specifier'
    ]),
    memberNodes: new Set([
      'function_definition',
      'function_declaration',
      'method_definition'
    ]),
    kindMap: {
      struct_specifier: 'StructDeclaration',
      class_specifier: 'ClassDeclaration',
      enum_specifier: 'EnumDeclaration',
      union_specifier: 'UnionDeclaration',
      function_definition: 'FunctionDeclaration',
      function_declaration: 'FunctionDeclaration',
      method_definition: 'MethodDeclaration'
    },
    docComments: { linePrefixes: ['///', '//'], blockStarts: ['/**'] }
  },
  cpp: {
    typeNodes: new Set([
      'class_specifier',
      'struct_specifier',
      'enum_specifier',
      'union_specifier',
      'namespace_definition'
    ]),
    memberNodes: new Set([
      'function_definition',
      'function_declaration',
      'method_definition'
    ]),
    kindMap: {
      class_specifier: 'ClassDeclaration',
      struct_specifier: 'StructDeclaration',
      enum_specifier: 'EnumDeclaration',
      union_specifier: 'UnionDeclaration',
      namespace_definition: 'NamespaceDeclaration',
      function_definition: 'FunctionDeclaration',
      function_declaration: 'FunctionDeclaration',
      method_definition: 'MethodDeclaration'
    },
    docComments: { linePrefixes: ['///', '//'], blockStarts: ['/**'] }
  },
  objc: {
    typeNodes: new Set([
      'class_interface',
      'protocol_declaration',
      'category_interface'
    ]),
    memberNodes: new Set([
      'method_definition',
      'method_declaration',
      'function_definition',
      'function_declaration'
    ]),
    kindMap: {
      class_interface: 'ClassDeclaration',
      protocol_declaration: 'ProtocolDeclaration',
      category_interface: 'CategoryDeclaration',
      method_definition: 'MethodDeclaration',
      method_declaration: 'MethodDeclaration',
      function_definition: 'FunctionDeclaration',
      function_declaration: 'FunctionDeclaration'
    },
    docComments: { linePrefixes: ['///', '//'], blockStarts: ['/**'] }
  },
  go: {
    typeNodes: new Set([
      'type_spec',
      'type_declaration'
    ]),
    memberNodes: new Set([
      'function_declaration',
      'method_declaration'
    ]),
    kindMap: {
      type_spec: 'TypeDeclaration',
      type_declaration: 'TypeDeclaration',
      function_declaration: 'FunctionDeclaration',
      method_declaration: 'MethodDeclaration'
    },
    docComments: { linePrefixes: ['//'], blockStarts: ['/**'] },
    resolveKind: (node, kind) => {
      if (node.type !== 'type_spec' && node.type !== 'type_declaration') return kind;
      const structNode = findDescendantByType(node, new Set(['struct_type']));
      if (structNode) return 'StructDeclaration';
      const ifaceNode = findDescendantByType(node, new Set(['interface_type']));
      if (ifaceNode) return 'InterfaceDeclaration';
      return kind;
    },
    resolveMemberName: (node, name) => {
      if (node.type !== 'method_declaration') return null;
      const receiver = node.childForFieldName('receiver');
      const receiverType = findDescendantByType(receiver, new Set(['type_identifier']));
      if (!receiverType) return null;
      return { name: `${receiverType.text}.${name}` };
    }
  },
  rust: {
    typeNodes: new Set([
      'struct_item',
      'enum_item',
      'trait_item',
      'impl_item',
      'mod_item'
    ]),
    memberNodes: new Set([
      'function_item',
      'function_definition',
      'method_definition',
      'macro_definition'
    ]),
    kindMap: {
      struct_item: 'StructDeclaration',
      enum_item: 'EnumDeclaration',
      trait_item: 'TraitDeclaration',
      impl_item: 'ImplDeclaration',
      mod_item: 'ModuleDeclaration',
      function_item: 'FunctionDeclaration',
      function_definition: 'FunctionDeclaration',
      method_definition: 'MethodDeclaration',
      macro_definition: 'MacroDeclaration'
    },
    docComments: { linePrefixes: ['///', '//'], blockStarts: ['/**'] },
    nameFields: ['name', 'type']
  },
  java: {
    typeNodes: new Set([
      'class_declaration',
      'interface_declaration',
      'enum_declaration',
      'record_declaration'
    ]),
    memberNodes: new Set([
      'method_declaration',
      'constructor_declaration'
    ]),
    kindMap: {
      class_declaration: 'ClassDeclaration',
      interface_declaration: 'InterfaceDeclaration',
      enum_declaration: 'EnumDeclaration',
      record_declaration: 'RecordDeclaration',
      method_declaration: 'MethodDeclaration',
      constructor_declaration: 'ConstructorDeclaration'
    },
    docComments: { linePrefixes: ['//'], blockStarts: ['/**'] }
  },
  html: {
    typeNodes: new Set([
      'element',
      'script_element',
      'style_element'
    ]),
    memberNodes: new Set([]),
    kindMap: {
      element: 'ElementDeclaration',
      script_element: 'ScriptElement',
      style_element: 'StyleElement'
    },
    nameNodeTypes: new Set(['tag_name'])
  }
};

function resolveLanguageId(languageId) {
  return typeof languageId === 'string' ? languageId : null;
}

function resolveWasmRoot() {
  if (wasmRoot) return wasmRoot;
  const pkgPath = require.resolve('tree-sitter-wasms/package.json');
  wasmRoot = path.join(path.dirname(pkgPath), 'out');
  return wasmRoot;
}

function resolveRuntimePath() {
  if (wasmRuntimePath) return wasmRuntimePath;
  const candidates = [
    'web-tree-sitter/web-tree-sitter.wasm',
    'web-tree-sitter/tree-sitter.wasm'
  ];
  for (const candidate of candidates) {
    try {
      wasmRuntimePath = require.resolve(candidate);
      return wasmRuntimePath;
    } catch {
      // try next candidate
    }
  }
  throw new Error('web-tree-sitter WASM runtime not found');
}

const normalizeTreeSitterWorkerConfig = (raw) => {
  if (raw === false) return { enabled: false };
  if (raw === true) return { enabled: true };
  if (!raw || typeof raw !== 'object') return { enabled: false };
  const enabled = raw.enabled !== false;
  const maxWorkersRaw = Number(raw.maxWorkers);
  const defaultMax = Math.max(1, Math.min(4, os.cpus().length));
  const maxWorkers = Number.isFinite(maxWorkersRaw) && maxWorkersRaw > 0
    ? Math.max(1, Math.floor(maxWorkersRaw))
    : defaultMax;
  const idleTimeoutMsRaw = Number(raw.idleTimeoutMs);
  const idleTimeoutMs = Number.isFinite(idleTimeoutMsRaw) && idleTimeoutMsRaw > 0
    ? Math.floor(idleTimeoutMsRaw)
    : 30000;
  const taskTimeoutMsRaw = Number(raw.taskTimeoutMs);
  const taskTimeoutMs = Number.isFinite(taskTimeoutMsRaw) && taskTimeoutMsRaw > 0
    ? Math.floor(taskTimeoutMsRaw)
    : 60000;
  return {
    enabled,
    maxWorkers,
    idleTimeoutMs,
    taskTimeoutMs
  };
};

const sanitizeTreeSitterOptions = (treeSitter) => {
  const config = treeSitter && typeof treeSitter === 'object' ? treeSitter : {};
  return {
    enabled: config.enabled !== false,
    languages: config.languages || {},
    maxBytes: config.maxBytes ?? null,
    maxLines: config.maxLines ?? null,
    maxParseMs: config.maxParseMs ?? null,
    byLanguage: config.byLanguage || {},
    configChunking: config.configChunking === true
  };
};

const getTreeSitterWorkerPool = async (rawConfig, options = {}) => {
  const config = normalizeTreeSitterWorkerConfig(rawConfig);
  if (!config.enabled) return null;
  const signature = JSON.stringify(config);
  if (treeSitterWorkerPool && treeSitterWorkerConfigSignature === signature) {
    return treeSitterWorkerPool;
  }
  if (treeSitterWorkerPool && treeSitterWorkerPool.destroy) {
    await treeSitterWorkerPool.destroy();
    treeSitterWorkerPool = null;
  }
  treeSitterWorkerConfigSignature = signature;
  let Piscina;
  try {
    Piscina = (await import('piscina')).default;
  } catch (err) {
    if (options?.log && !loggedWorkerFailures.has('piscina')) {
      options.log(`[tree-sitter] Worker pool unavailable (piscina missing): ${err?.message || err}.`);
      loggedWorkerFailures.add('piscina');
    }
    return null;
  }
  try {
    treeSitterWorkerPool = new Piscina({
      filename: fileURLToPath(new URL('./workers/tree-sitter-worker.js', import.meta.url)),
      maxThreads: config.maxWorkers,
      idleTimeout: config.idleTimeoutMs,
      taskTimeout: config.taskTimeoutMs
    });
    return treeSitterWorkerPool;
  } catch (err) {
    if (options?.log && !loggedWorkerFailures.has('init')) {
      options.log(`[tree-sitter] Worker pool init failed: ${err?.message || err}.`);
      loggedWorkerFailures.add('init');
    }
    treeSitterWorkerPool = null;
    return null;
  }
};

export async function initTreeSitterWasm(options = {}) {
  if (TreeSitter || treeSitterInitError) return Boolean(TreeSitter);
  if (treeSitterInitPromise) return treeSitterInitPromise;
  treeSitterInitPromise = (async () => {
    try {
      const mod = require('web-tree-sitter');
      TreeSitter = mod?.Parser || mod;
      if (!TreeSitter?.init) {
        throw new Error('web-tree-sitter Parser not available');
      }
      await TreeSitter.init({
        locateFile: () => resolveRuntimePath()
      });
      TreeSitterLanguage = mod?.Language || TreeSitter?.Language || null;
      if (!TreeSitterLanguage) {
        throw new Error('web-tree-sitter Language not available');
      }
      return true;
    } catch (err) {
      treeSitterInitError = err;
      TreeSitter = null;
      TreeSitterLanguage = null;
      if (options?.log) {
        options.log(`[tree-sitter] WASM init failed: ${err?.message || err}.`);
      }
      return false;
    }
  })();
  return treeSitterInitPromise;
}

async function loadWasmLanguage(languageId, options = {}) {
  const resolvedId = resolveLanguageId(languageId);
  if (!resolvedId) return { language: null, error: new Error('invalid language id') };
  const cached = languageCache.get(resolvedId);
  if (cached?.language || cached?.error) return cached;
  const pending = languageLoadPromises.get(resolvedId);
  if (pending) return pending;
  const promise = (async () => {
    const ok = await initTreeSitterWasm(options);
    if (!ok) {
      return { language: null, error: treeSitterInitError || new Error('Tree-sitter WASM init failed') };
    }
    const wasmFile = LANGUAGE_WASM_FILES[resolvedId];
    if (!wasmFile) {
      return { language: null, error: new Error(`Missing WASM file for ${resolvedId}`) };
    }
    try {
      const wasmPath = path.join(resolveWasmRoot(), wasmFile);
      const wasmBytes = await fs.readFile(wasmPath);
      const language = await TreeSitterLanguage.load(wasmBytes);
      const entry = { language, error: null };
      languageCache.set(resolvedId, entry);
      return entry;
    } catch (err) {
      const entry = { language: null, error: err };
      languageCache.set(resolvedId, entry);
      return entry;
    } finally {
      languageLoadPromises.delete(resolvedId);
    }
  })();
  languageLoadPromises.set(resolvedId, promise);
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

export function resolveEnabledTreeSitterLanguages(config = {}) {
  const options = { treeSitter: config };
  return TREE_SITTER_LANGUAGE_IDS.filter((id) => isTreeSitterEnabled(options, id));
}

export function getTreeSitterParser(languageId, options = {}) {
  if (!TreeSitter) {
    const resolvedId = resolveLanguageId(languageId);
    if (resolvedId && !loggedInitFailure.has(resolvedId) && options?.log) {
      const reason = treeSitterInitError?.message || 'WASM runtime not initialized';
      options.log(`[tree-sitter] WASM runtime unavailable for ${resolvedId} (${reason}).`);
      loggedInitFailure.add(resolvedId);
    }
    return null;
  }
  const resolvedId = resolveLanguageId(languageId);
  if (!resolvedId) return null;
  if (parserCache.has(resolvedId)) return parserCache.get(resolvedId);
  const entry = languageCache.get(resolvedId) || null;
  const language = entry?.language || null;
  if (!language) {
    if (!loggedMissing.has(resolvedId)) {
      const reason = entry?.error?.message || 'WASM grammar not loaded';
      if (options?.log) {
        options.log(`[tree-sitter] Missing WASM grammar for ${resolvedId} (${reason}).`);
      } else {
        console.warn(`[tree-sitter] Missing WASM grammar for ${resolvedId} (${reason}).`);
      }
      loggedMissing.add(resolvedId);
    }
    return null;
  }
  const parser = new TreeSitter();
  try {
    parser.setLanguage(language);
  } catch (err) {
    parserCache.set(resolvedId, null);
    if (!loggedMissing.has(resolvedId)) {
      const message = err?.message || err;
      const log = options?.log || console.warn;
      log(`[tree-sitter] Failed to load ${resolvedId} WASM grammar: ${message}.`);
      loggedMissing.add(resolvedId);
    }
    return null;
  }
  parserCache.set(resolvedId, parser);
  return parser;
}

function normalizeEnabled(value) {
  if (value === false) return false;
  if (value === 'off') return false;
  return true;
}

function isTreeSitterEnabled(options, languageId) {
  const config = options?.treeSitter || {};
  const enabled = normalizeEnabled(config.enabled);
  if (!enabled) return false;
  const langs = config.languages || {};
  if (languageId && Object.prototype.hasOwnProperty.call(langs, languageId)) {
    return normalizeEnabled(langs[languageId]);
  }
  if ((languageId === 'cpp' || languageId === 'objc')
    && Object.prototype.hasOwnProperty.call(langs, 'clike')) {
    return normalizeEnabled(langs.clike);
  }
  return true;
}

function countLines(text) {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

const createLineAccessor = (text, lineIndex) => {
  const index = Array.isArray(lineIndex) ? lineIndex : buildLineIndex(text);
  const lineCount = index.length;
  return {
    length: lineCount,
    getLine: (idx) => {
      if (!Number.isFinite(idx) || idx < 0 || idx >= lineCount) return '';
      const start = index[idx] ?? 0;
      const end = index[idx + 1] ?? text.length;
      let line = text.slice(start, end);
      if (line.endsWith('\n')) line = line.slice(0, -1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      return line;
    }
  };
};

function exceedsTreeSitterLimits(text, options, resolvedId) {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.[resolvedId] || {};
  const maxBytes = perLanguage.maxBytes ?? config.maxBytes;
  const maxLines = perLanguage.maxLines ?? config.maxLines;
  if (typeof maxBytes === 'number' && maxBytes > 0) {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) {
      const key = `${resolvedId}:bytes`;
      if (!loggedSizeSkips.has(key) && options?.log) {
        options.log(`Tree-sitter disabled for ${resolvedId}; file exceeds maxBytes (${bytes} > ${maxBytes}).`);
        loggedSizeSkips.add(key);
      }
      return true;
    }
  }
  if (typeof maxLines === 'number' && maxLines > 0) {
    const lines = countLines(text);
    if (lines > maxLines) {
      const key = `${resolvedId}:lines`;
      if (!loggedSizeSkips.has(key) && options?.log) {
        options.log(`Tree-sitter disabled for ${resolvedId}; file exceeds maxLines (${lines} > ${maxLines}).`);
        loggedSizeSkips.add(key);
      }
      return true;
    }
  }
  return false;
}

function resolveParseTimeoutMs(options, resolvedId) {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.[resolvedId] || {};
  const raw = perLanguage.maxParseMs ?? config.maxParseMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function extractSignature(text, start, end) {
  const limit = Math.min(end, start + 2000);
  const slice = text.slice(start, limit);
  const newline = slice.indexOf('\n');
  const brace = slice.indexOf('{');
  const semi = slice.indexOf(';');
  const arrow = slice.indexOf('=>');
  const candidates = [newline, brace, semi].filter((idx) => idx >= 0);
  if (arrow >= 0) candidates.push(arrow + 2);
  const cutoff = candidates.length ? Math.min(...candidates) : slice.length;
  const endIdx = start + cutoff;
  return sliceSignature(text, start, endIdx).replace(/\s+/g, ' ').trim();
}

function findNameNode(node, config) {
  if (!node) return null;
  const direct = node.childForFieldName('name');
  if (direct) return direct;
  const fieldNames = Array.isArray(config?.nameFields) ? config.nameFields : [];
  for (const field of fieldNames) {
    const child = node.childForFieldName(field);
    if (child) return child;
  }
  const nameTypes = config?.nameNodeTypes || COMMON_NAME_NODE_TYPES;
  const declarator = node.childForFieldName('declarator');
  if (declarator) {
    const named = findDescendantByType(declarator, nameTypes, 8);
    if (named) return named;
  }
  const queue = [];
  const initialCount = getNamedChildCount(node);
  for (let i = 0; i < initialCount; i += 1) {
    queue.push(getNamedChild(node, i));
  }
  let depth = 0;
  while (queue.length && depth < 4) {
    const next = queue.shift();
    if (!next) {
      depth += 1;
      continue;
    }
    if (nameTypes.has(next.type)) return next;
    const childCount = getNamedChildCount(next);
    for (let i = 0; i < childCount; i += 1) {
      queue.push(getNamedChild(next, i));
    }
    depth += 1;
  }
  return null;
}

function extractNodeName(node, text, config) {
  const nameNode = findNameNode(node, config);
  if (!nameNode) return '';
  return text.slice(nameNode.startIndex, nameNode.endIndex).trim();
}

function findNearestType(node, config) {
  let current = node?.parent || null;
  while (current) {
    if (config.typeNodes.has(current.type)) return current;
    current = current.parent;
  }
  return null;
}

function gatherChunkNodes(root, config) {
  const nodes = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    const missing = typeof node.isMissing === 'function' ? node.isMissing() : node.isMissing;
    if (missing) continue;
    if (config.typeNodes.has(node.type) || config.memberNodes.has(node.type)) {
      nodes.push(node);
    }
    const count = getNamedChildCount(node);
    for (let i = count - 1; i >= 0; i -= 1) {
      stack.push(getNamedChild(node, i));
    }
  }
  return nodes;
}

function toChunk(node, text, config, lineIndex, lineAccessor) {
  const name = extractNodeName(node, text, config);
  if (!name) return null;
  let kind = config.kindMap[node.type] || 'Declaration';
  if (typeof config.resolveKind === 'function') {
    kind = config.resolveKind(node, kind, text) || kind;
  }
  const start = node.startIndex;
  const end = node.endIndex;
  const parentType = findNearestType(node, config);
  let fullName = name;
  let finalKind = kind;
  if (parentType && config.memberNodes.has(node.type)) {
    const parentName = extractNodeName(parentType, text, config);
    if (parentName) fullName = `${parentName}.${name}`;
    if (kind === 'FunctionDeclaration') finalKind = 'MethodDeclaration';
  }
  if (!parentType && config.memberNodes.has(node.type)
    && typeof config.resolveMemberName === 'function') {
    const resolved = config.resolveMemberName(node, name, text);
    if (resolved?.name) fullName = resolved.name;
    if (resolved?.kind) finalKind = resolved.kind;
  }
  const startLine = offsetToLine(lineIndex, start);
  const endOffset = end > start ? end - 1 : start;
  const endLine = offsetToLine(lineIndex, endOffset);
  const signature = extractSignature(text, start, end);
  const docstring = extractDocComment(
    lineAccessor,
    startLine - 1,
    config.docComments || {}
  );
  return {
    start,
    end,
    name: fullName,
    kind: finalKind,
    meta: {
      startLine,
      endLine,
      signature,
      docstring
    }
  };
}

function resolveLanguageForExt(languageId, ext) {
  const normalizedExt = typeof ext === 'string' ? ext.toLowerCase() : '';
  if (normalizedExt === '.tsx') return 'tsx';
  if (normalizedExt === '.jsx') return 'jsx';
  if (normalizedExt === '.ts' || normalizedExt === '.cts' || normalizedExt === '.mts') return 'typescript';
  if (normalizedExt === '.js' || normalizedExt === '.mjs' || normalizedExt === '.cjs' || normalizedExt === '.jsm') return 'javascript';
  if (normalizedExt === '.py') return 'python';
  if (normalizedExt === '.json') return 'json';
  if (normalizedExt === '.yaml' || normalizedExt === '.yml') return 'yaml';
  if (normalizedExt === '.toml') return 'toml';
  if (normalizedExt === '.md' || normalizedExt === '.mdx') return 'markdown';
  if (languageId) return languageId;
  if (!normalizedExt) return null;
  if (normalizedExt === '.m' || normalizedExt === '.mm') return 'objc';
  if (normalizedExt === '.cpp' || normalizedExt === '.cc' || normalizedExt === '.cxx' || normalizedExt === '.hpp' || normalizedExt === '.hh') return 'cpp';
  if (normalizedExt === '.c' || normalizedExt === '.h') return 'clike';
  return null;
}

export function buildTreeSitterChunks({ text, languageId, ext, options }) {
  const resolvedId = resolveLanguageForExt(languageId, ext);
  if (!resolvedId) return null;
  if (!isTreeSitterEnabled(options, resolvedId)) return null;
  if (exceedsTreeSitterLimits(text, options, resolvedId)) return null;
  const parser = getTreeSitterParser(resolvedId, options);
  if (!parser) {
    if (options?.log && !loggedUnavailable.has(resolvedId)) {
      options.log(`Tree-sitter unavailable for ${resolvedId}; falling back to heuristic chunking.`);
      loggedUnavailable.add(resolvedId);
    }
    return null;
  }
  const config = LANG_CONFIG[resolvedId];
  if (!config) return null;
  let tree;
  try {
    const parseTimeoutMs = resolveParseTimeoutMs(options, resolvedId);
    if (typeof parser.setTimeoutMicros === 'function') {
      parser.setTimeoutMicros(parseTimeoutMs ? parseTimeoutMs * 1000 : 0);
    }
    tree = parser.parse(text);
  } catch (err) {
    const message = err?.message || String(err);
    if (/timeout/i.test(message)) {
      if (options?.log && !loggedParseTimeouts.has(resolvedId)) {
        options.log(`Tree-sitter parse timed out for ${resolvedId}; falling back to heuristic chunking.`);
        loggedParseTimeouts.add(resolvedId);
      }
      return null;
    }
    return null;
  }
  let rootNode = null;
  try {
    rootNode = tree.rootNode;
  } catch (err) {
    if (!loggedParseFailures.has(resolvedId) && options?.log) {
      options.log(`Tree-sitter parse failed for ${resolvedId}; falling back to heuristic chunking.`);
      loggedParseFailures.add(resolvedId);
    }
    return null;
  }
  const lineIndex = buildLineIndex(text);
  const lineAccessor = createLineAccessor(text, lineIndex);
  let nodes = [];
  try {
    nodes = gatherChunkNodes(rootNode, config);
  } catch (err) {
    if (!loggedParseFailures.has(resolvedId) && options?.log) {
      options.log(`Tree-sitter parse failed for ${resolvedId}; falling back to heuristic chunking.`);
      loggedParseFailures.add(resolvedId);
    }
    return null;
  }
  if (!nodes.length) return null;
  const chunks = [];
  for (const node of nodes) {
    const chunk = toChunk(node, text, config, lineIndex, lineAccessor);
    if (chunk) chunks.push(chunk);
  }
  if (!chunks.length) return null;
  chunks.sort((a, b) => a.start - b.start);
  return chunks;
}

export async function buildTreeSitterChunksAsync({ text, languageId, ext, options }) {
  if (!options?.treeSitter || options.treeSitter.enabled === false) {
    return buildTreeSitterChunks({ text, languageId, ext, options });
  }
  const pool = await getTreeSitterWorkerPool(options?.treeSitter?.worker, options);
  if (!pool) {
    return buildTreeSitterChunks({ text, languageId, ext, options });
  }
  const payload = {
    text,
    languageId,
    ext,
    treeSitter: sanitizeTreeSitterOptions(options?.treeSitter)
  };
  try {
    const result = await pool.run(payload, { name: 'parseTreeSitter' });
    return Array.isArray(result) ? result : null;
  } catch (err) {
    if (options?.log && !loggedWorkerFailures.has('run')) {
      options.log(`[tree-sitter] Worker parse failed; falling back to main thread (${err?.message || err}).`);
      loggedWorkerFailures.add('run');
    }
    return buildTreeSitterChunks({ text, languageId, ext, options });
  }
}

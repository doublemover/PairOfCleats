import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
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
const loggedSizeSkips = new Set();
const loggedUnavailable = new Set();

const LANGUAGE_WASM_FILES = {
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

function findDescendantByType(root, types, maxDepth = 6) {
  if (!root) return null;
  const stack = [{ node: root, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (!node) continue;
    if (types.has(node.type)) return node;
    if (depth >= maxDepth) continue;
    if (node.namedChildren && node.namedChildren.length) {
      for (let i = node.namedChildren.length - 1; i >= 0; i -= 1) {
        stack.push({ node: node.namedChildren[i], depth: depth + 1 });
      }
    }
  }
  return null;
}

const LANG_CONFIG = {
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
  for (const id of unique) {
    // Load sequentially to avoid wasm runtime contention.
    await loadWasmLanguage(id, options);
  }
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

function exceedsTreeSitterLimits(text, options, resolvedId) {
  const config = options?.treeSitter || {};
  const maxBytes = config.maxBytes;
  const maxLines = config.maxLines;
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
  const queue = [...node.namedChildren];
  let depth = 0;
  while (queue.length && depth < 4) {
    const next = queue.shift();
    if (nameTypes.has(next.type)) return next;
    if (next.namedChildren && next.namedChildren.length) {
      queue.push(...next.namedChildren);
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
    if (node.namedChildren && node.namedChildren.length) {
      for (let i = node.namedChildren.length - 1; i >= 0; i -= 1) {
        stack.push(node.namedChildren[i]);
      }
    }
  }
  return nodes;
}

function toChunk(node, text, config, lineIndex, lines) {
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
  const docstring = extractDocComment(lines, startLine - 1, config.docComments || {});
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
  if (languageId) return languageId;
  if (!ext) return null;
  if (ext === '.m' || ext === '.mm') return 'objc';
  if (ext === '.cpp' || ext === '.cc' || ext === '.cxx' || ext === '.hpp' || ext === '.hh') return 'cpp';
  if (ext === '.c' || ext === '.h') return 'clike';
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
    tree = parser.parse(text);
  } catch {
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
  const lines = text.split('\n');
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
    const chunk = toChunk(node, text, config, lineIndex, lines);
    if (chunk) chunks.push(chunk);
  }
  if (!chunks.length) return null;
  chunks.sort((a, b) => a.start - b.start);
  return chunks;
}

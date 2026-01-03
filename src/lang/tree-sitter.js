import { createRequire } from 'node:module';
import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { extractDocComment, sliceSignature } from './shared.js';

const require = createRequire(import.meta.url);
let TreeSitter = null;
let treeSitterLoadError = null;
const parserCache = new Map();
const languageCache = new Map();
const loggedMissing = new Set();
const loggedParseFailures = new Set();

const LANGUAGE_MODULES = {
  swift: 'tree-sitter-swift',
  kotlin: 'tree-sitter-kotlin',
  csharp: 'tree-sitter-c-sharp',
  clike: 'tree-sitter-c',
  cpp: 'tree-sitter-cpp',
  objc: 'tree-sitter-objc',
  go: 'tree-sitter-go',
  rust: 'tree-sitter-rust',
  java: 'tree-sitter-java'
};

const COMMON_NAME_NODE_TYPES = new Set([
  'identifier',
  'type_identifier',
  'scoped_identifier',
  'qualified_identifier',
  'field_identifier',
  'simple_identifier',
  'namespace_identifier'
]);

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
    docComments: { linePrefixes: ['///', '//'] }
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
      'method_declaration'
    ]),
    kindMap: {
      class_interface: 'ClassDeclaration',
      protocol_declaration: 'ProtocolDeclaration',
      category_interface: 'CategoryDeclaration',
      method_definition: 'MethodDeclaration',
      method_declaration: 'MethodDeclaration'
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
    docComments: { linePrefixes: ['//'], blockStarts: ['/**'] }
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
      'method_definition'
    ]),
    kindMap: {
      struct_item: 'StructDeclaration',
      enum_item: 'EnumDeclaration',
      trait_item: 'TraitDeclaration',
      impl_item: 'ImplDeclaration',
      mod_item: 'ModuleDeclaration',
      function_item: 'FunctionDeclaration',
      function_definition: 'FunctionDeclaration',
      method_definition: 'MethodDeclaration'
    },
    docComments: { linePrefixes: ['///', '//'], blockStarts: ['/**'] }
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
  }
};

function loadTreeSitter() {
  if (TreeSitter || treeSitterLoadError) return TreeSitter;
  try {
    TreeSitter = require('tree-sitter');
  } catch (err) {
    treeSitterLoadError = err;
    TreeSitter = null;
  }
  return TreeSitter;
}

function loadLanguageModule(moduleName) {
  if (!moduleName) return null;
  if (languageCache.has(moduleName)) return languageCache.get(moduleName);
  let mod = null;
  let error = null;
  try {
    mod = require(moduleName);
  } catch (err) {
    mod = null;
    error = err;
  }
  const resolved = mod?.language || mod?.default || mod || null;
  const entry = { language: resolved, error };
  languageCache.set(moduleName, entry);
  return entry;
}

function resolveLanguageId(languageId) {
  return typeof languageId === 'string' ? languageId : null;
}

function getParser(languageId) {
  const Parser = loadTreeSitter();
  if (!Parser) return null;
  const resolvedId = resolveLanguageId(languageId);
  if (!resolvedId) return null;
  if (parserCache.has(resolvedId)) return parserCache.get(resolvedId);
  const moduleName = LANGUAGE_MODULES[resolvedId];
  const entry = loadLanguageModule(moduleName);
  const language = entry?.language || null;
  if (!language) {
    if (!loggedMissing.has(resolvedId)) {
      const reason = entry?.error?.message || 'module not available';
      console.warn(`[tree-sitter] Missing grammar for ${resolvedId} (${reason}). Install ${moduleName} with native bindings.`);
      loggedMissing.add(resolvedId);
    }
    return null;
  }
  const parser = new Parser();
  try {
    parser.setLanguage(language);
  } catch (err) {
    parserCache.set(resolvedId, null);
    if (!loggedMissing.has(resolvedId)) {
      console.warn(`[tree-sitter] Failed to load ${resolvedId}: ${err?.message || err}. Rebuild ${moduleName} native bindings.`);
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
    if (!node || node.isMissing) continue;
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
  const kind = config.kindMap[node.type] || 'Declaration';
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
  const parser = getParser(resolvedId);
  if (!parser) {
    if (!loggedMissing && options?.log) {
      options.log(`Tree-sitter unavailable for ${resolvedId}; falling back to heuristic chunking.`);
      loggedMissing = true;
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

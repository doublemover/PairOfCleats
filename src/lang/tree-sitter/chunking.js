import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { extractDocComment, sliceSignature } from '../shared.js';
import {
  COMMON_NAME_NODE_TYPES,
  findDescendantByType,
  getNamedChild,
  getNamedChildCount
} from './ast.js';
import { LANG_CONFIG } from './config.js';
import { isTreeSitterEnabled } from './options.js';
import { getTreeSitterParser } from './runtime.js';
import { treeSitterState } from './state.js';
import { getTreeSitterWorkerPool, sanitizeTreeSitterOptions } from './worker.js';

const loggedParseFailures = new Set();
const loggedParseTimeouts = new Set();
const loggedSizeSkips = new Set();
const loggedUnavailable = new Set();

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
  if (normalizedExt === '.js' || normalizedExt === '.mjs' || normalizedExt === '.cjs' || normalizedExt === '.jsm') {
    return 'javascript';
  }
  if (normalizedExt === '.py') return 'python';
  if (normalizedExt === '.json') return 'json';
  if (normalizedExt === '.yaml' || normalizedExt === '.yml') return 'yaml';
  if (normalizedExt === '.toml') return 'toml';
  if (normalizedExt === '.md' || normalizedExt === '.mdx') return 'markdown';
  if (languageId) return languageId;
  if (!normalizedExt) return null;
  if (normalizedExt === '.m' || normalizedExt === '.mm') return 'objc';
  if (normalizedExt === '.cpp' || normalizedExt === '.cc' || normalizedExt === '.cxx'
    || normalizedExt === '.hpp' || normalizedExt === '.hh') return 'cpp';
  if (normalizedExt === '.c' || normalizedExt === '.h') return 'clike';
  return null;
}

export function buildTreeSitterChunks({ text, languageId, ext, options }) {
  const resolvedId = resolveLanguageForExt(languageId, ext);
  if (!resolvedId) return null;
  if (!isTreeSitterEnabled(options, resolvedId)) return null;
  if (exceedsTreeSitterLimits(text, options, resolvedId)) return null;
  const metricsCollector = options?.metricsCollector;
  const shouldRecordMetrics = metricsCollector && typeof metricsCollector.add === 'function';
  const lineCount = shouldRecordMetrics ? countLines(text) : 0;
  const metricsStart = shouldRecordMetrics ? Date.now() : 0;
  const recordMetrics = () => {
    if (!shouldRecordMetrics) return;
    const durationMs = Date.now() - metricsStart;
    metricsCollector.add('treeSitter', resolvedId, lineCount, durationMs);
  };
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
    recordMetrics();
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
    recordMetrics();
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
    recordMetrics();
    if (!loggedParseFailures.has(resolvedId) && options?.log) {
      options.log(`Tree-sitter parse failed for ${resolvedId}; falling back to heuristic chunking.`);
      loggedParseFailures.add(resolvedId);
    }
    return null;
  }
  if (!nodes.length) {
    recordMetrics();
    return null;
  }
  const chunks = [];
  for (const node of nodes) {
    const chunk = toChunk(node, text, config, lineIndex, lineAccessor);
    if (chunk) chunks.push(chunk);
  }
  if (!chunks.length) {
    recordMetrics();
    return null;
  }
  chunks.sort((a, b) => a.start - b.start);
  recordMetrics();
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
  const resolvedId = resolveLanguageForExt(languageId, ext) || languageId || 'unknown';
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
  try {
    const result = await pool.run(payload, { name: 'parseTreeSitter' });
    return Array.isArray(result) ? result : null;
  } catch (err) {
    if (options?.log && !treeSitterState.loggedWorkerFailures.has('run')) {
      options.log(`[tree-sitter] Worker parse failed; falling back to main thread (${err?.message || err}).`);
      treeSitterState.loggedWorkerFailures.add('run');
    }
    return buildTreeSitterChunks({ text, languageId, ext, options });
  } finally {
    if (shouldRecordMetrics) {
      const durationMs = Date.now() - metricsStart;
      metricsCollector.add('treeSitter', resolvedId, lineCount, durationMs);
    }
  }
}

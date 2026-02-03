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
import { getTreeSitterParser, preloadTreeSitterLanguages } from './runtime.js';
import { treeSitterState } from './state.js';
import { getTreeSitterWorkerPool, sanitizeTreeSitterOptions } from './worker.js';

const loggedParseFailures = new Set();
const loggedParseTimeouts = new Set();
const loggedSizeSkips = new Set();
const loggedUnavailable = new Set();
const loggedTraversalBudget = new Set();

// Guardrails: keep tree traversal and chunk extraction bounded even on pathological inputs.
// These caps are intentionally conservative for JS/TS where nested lambdas/callbacks can be dense.
const DEFAULT_MAX_AST_NODES = 250_000;
const DEFAULT_MAX_AST_STACK = 250_000;
const DEFAULT_MAX_CHUNK_NODES = 5_000;

const JS_TS_LANGUAGE_IDS = new Set(['javascript', 'typescript', 'tsx', 'jsx']);

function resolveTraversalBudget(options, resolvedId) {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.[resolvedId] || {};
  const isJsTs = JS_TS_LANGUAGE_IDS.has(resolvedId);
  const defaultMaxChunkNodes = isJsTs ? 1_000 : DEFAULT_MAX_CHUNK_NODES;
  const maxAstNodes = perLanguage.maxAstNodes ?? config.maxAstNodes ?? DEFAULT_MAX_AST_NODES;
  const maxAstStack = perLanguage.maxAstStack ?? config.maxAstStack ?? DEFAULT_MAX_AST_STACK;
  const maxChunkNodes = perLanguage.maxChunkNodes ?? config.maxChunkNodes ?? defaultMaxChunkNodes;
  return {
    maxAstNodes: Number.isFinite(maxAstNodes) && maxAstNodes > 0 ? Math.floor(maxAstNodes) : DEFAULT_MAX_AST_NODES,
    maxAstStack: Number.isFinite(maxAstStack) && maxAstStack > 0 ? Math.floor(maxAstStack) : DEFAULT_MAX_AST_STACK,
    maxChunkNodes: Number.isFinite(maxChunkNodes) && maxChunkNodes > 0 ? Math.floor(maxChunkNodes) : defaultMaxChunkNodes
  };
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

const DEFAULT_NAME_SEARCH_MAX_DEPTH = 6;
const DEFAULT_NAME_SEARCH_MAX_NODES = 128;

function findNameNode(node, config) {
  const nameTypes = (config?.nameTypes && config.nameTypes.size) ? config.nameTypes : COMMON_NAME_NODE_TYPES;
  if (!node) return null;

  // Traversal limits: names should be close to the declaration node, but some grammars
  // wrap identifiers a few levels deep. Keep this bounded and deterministic.
  const maxDepth = Number.isFinite(config?.nameSearchMaxDepth)
    ? Math.max(1, Math.floor(config.nameSearchMaxDepth))
    : DEFAULT_NAME_SEARCH_MAX_DEPTH;

  const maxNodes = Number.isFinite(config?.nameSearchMaxNodes)
    ? Math.max(1, Math.floor(config.nameSearchMaxNodes))
    : DEFAULT_NAME_SEARCH_MAX_NODES;

  let frontier = [];
  const initialCount = getNamedChildCount(node);
  for (let i = 0; i < initialCount; i += 1) {
    const child = getNamedChild(node, i);
    if (child) frontier.push(child);
  }

  let visited = 0;
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const nextFrontier = [];

    for (const next of frontier) {
      if (!next) continue;
      visited += 1;
      if (nameTypes.has(next.type)) return next;
      if (visited >= maxNodes) return null;

      const childCount = getNamedChildCount(next);
      for (let i = 0; i < childCount; i += 1) {
        const child = getNamedChild(next, i);
        if (child) nextFrontier.push(child);
      }
    }

    frontier = nextFrontier;
  }

  return null;
}

function sliceNodeText(node, text) {
  if (!node || typeof text !== 'string') return '';
  const start = Number(node.startIndex);
  const end = Number(node.endIndex);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '';
  if (start < 0 || end < 0 || end <= start || start > text.length) return '';
  return text.slice(start, Math.min(end, text.length));
}

function extractNodeName(node, text, config) {
  if (!node) return '';

  // Optional language-specific resolver (e.g., markdown headings).
  if (typeof config?.resolveName === 'function') {
    try {
      const resolved = config.resolveName(node, text);
      if (typeof resolved === 'string') return resolved.trim();
      if (resolved && typeof resolved.name === 'string') return resolved.name.trim();
    } catch {
      // Ignore resolver failures; fall back to generic extraction.
    }
  }

  // Prefer field-based naming when supported by the grammar.
  const nameFields = Array.isArray(config?.nameFields) ? config.nameFields : null;
  if (nameFields && typeof node.childForFieldName === 'function') {
    for (const field of nameFields) {
      if (typeof field !== 'string' || !field) continue;
      try {
        const fieldNode = node.childForFieldName(field);
        const raw = sliceNodeText(fieldNode, text);
        const trimmed = raw.trim();
        if (trimmed) return trimmed;
      } catch {
        // ignore field extraction failures
      }
    }
  }

  // Fall back to a bounded BFS for a nearby common identifier node.
  const nameNode = findNameNode(node, config);
  if (!nameNode) return '';
  return sliceNodeText(nameNode, text).trim();
}


function findNearestType(node, config) {
  let current = node?.parent || null;
  while (current) {
    if (config.typeNodes.has(current.type)) return current;
    current = current.parent;
  }
  return null;
}

function gatherChunkNodes(root, config, budget) {
  const nodes = [];
  const stack = [root];
  let visited = 0;
  const maxAstNodes = budget?.maxAstNodes ?? DEFAULT_MAX_AST_NODES;
  const maxAstStack = budget?.maxAstStack ?? DEFAULT_MAX_AST_STACK;
  const maxChunkNodes = budget?.maxChunkNodes ?? DEFAULT_MAX_CHUNK_NODES;
  while (stack.length) {
    if (stack.length > maxAstStack) {
      return { nodes: null, reason: 'maxAstStack', visited, matched: nodes.length };
    }
    const node = stack.pop();
    if (!node) continue;
    visited += 1;
    if (visited > maxAstNodes) {
      return { nodes: null, reason: 'maxAstNodes', visited, matched: nodes.length };
    }
    const missing = typeof node.isMissing === 'function' ? node.isMissing() : node.isMissing;
    if (missing) continue;
    if (config.typeNodes.has(node.type) || config.memberNodes.has(node.type)) {
      nodes.push(node);
      if (nodes.length > maxChunkNodes) {
        return { nodes: null, reason: 'maxChunkNodes', visited, matched: nodes.length };
      }
    }
    const count = getNamedChildCount(node);
    for (let i = count - 1; i >= 0; i -= 1) {
      stack.push(getNamedChild(node, i));
    }
  }
  return { nodes, reason: null, visited, matched: nodes.length };
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
  const shouldDeferMissing = options?.treeSitterMissingLanguages
    && options?.treeSitter?.deferMissing !== false;
  const parser = getTreeSitterParser(resolvedId, options);
  if (!parser) {
    if (shouldDeferMissing) {
      options.treeSitterMissingLanguages.add(resolvedId);
      return null;
    }
    if (options?.treeSitterMissingLanguages) {
      options.treeSitterMissingLanguages.add(resolvedId);
    }
    if (options?.log && !loggedUnavailable.has(resolvedId)) {
      options.log(`Tree-sitter unavailable for ${resolvedId}; falling back to heuristic chunking.`);
      loggedUnavailable.add(resolvedId);
    }
    return null;
  }
  const config = LANG_CONFIG[resolvedId];
  if (!config) return null;
  const traversalBudget = resolveTraversalBudget(options, resolvedId);
  let tree = null;
  try {
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
    } catch {
      recordMetrics();
      if (!loggedParseFailures.has(resolvedId) && options?.log) {
        options.log(`Tree-sitter parse failed for ${resolvedId}; falling back to heuristic chunking.`);
        loggedParseFailures.add(resolvedId);
      }
      return null;
    }

    let nodes = [];
    try {
      const result = gatherChunkNodes(rootNode, config, traversalBudget);
      if (!result?.nodes) {
        recordMetrics();
        const key = `${resolvedId}:${result?.reason || 'budget'}`;
        if (options?.log && !loggedTraversalBudget.has(key)) {
          options.log(
            `Tree-sitter traversal aborted for ${resolvedId} (${result?.reason}); `
              + `visited=${result?.visited ?? 'n/a'} matched=${result?.matched ?? 'n/a'}. `
              + 'Falling back to heuristic chunking.'
          );
          loggedTraversalBudget.add(key);
        }
        return null;
      }
      nodes = result.nodes;
    } catch {
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

    const lineIndex = buildLineIndex(text);
    const lineAccessor = createLineAccessor(text, lineIndex);
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
  } finally {
    // web-tree-sitter `Tree` objects hold WASM-backed memory and must be explicitly released.
    try {
      if (tree && typeof tree.delete === 'function') tree.delete();
    } catch {
      // ignore disposal failures
    }

    // Some tree-sitter builds retain internal parse stack allocations across parses.
    // Resetting keeps memory bounded across long-running indexing jobs.
    try {
      if (parser && typeof parser.reset === 'function') parser.reset();
    } catch {
      // ignore reset failures
    }
  }
}

export async function buildTreeSitterChunksAsync({ text, languageId, ext, options }) {
  // If tree-sitter is disabled (or no config provided), keep the synchronous behavior.
  if (!options?.treeSitter || options.treeSitter.enabled === false) {
    return buildTreeSitterChunks({ text, languageId, ext, options });
  }

  const resolvedId = resolveLanguageForExt(languageId, ext);
  if (!resolvedId) return null;

  // Avoid spinning up / dispatching to workers when we already know we will skip tree-sitter.
  if (!isTreeSitterEnabled(options, resolvedId)) return null;
  if (exceedsTreeSitterLimits(text, options, resolvedId)) return null;
  if (!LANG_CONFIG[resolvedId]) return null;

  const pool = await getTreeSitterWorkerPool(options?.treeSitter?.worker, options);
  if (!pool) {
    try {
      await preloadTreeSitterLanguages([resolvedId], {
        log: options?.log,
        maxLoadedLanguages: options?.treeSitter?.maxLoadedLanguages
      });
    } catch {
      // If the runtime or grammar load fails, fall back to heuristic chunking.
    }
    return buildTreeSitterChunks({ text, languageId, ext, options });
  }

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

  // Avoid double-counting tree-sitter metrics when falling back to in-thread parsing.
  const fallbackOptions = shouldRecordMetrics
    ? { ...options, metricsCollector: null }
    : options;

  try {
    const result = await pool.run(payload, { name: 'parseTreeSitter' });
    if (Array.isArray(result)) return result;

    // Null/empty results from a worker are treated as a failure signal; retry in-thread for determinism.
    try {
      await preloadTreeSitterLanguages([resolvedId], {
        log: options?.log,
        maxLoadedLanguages: options?.treeSitter?.maxLoadedLanguages
      });
    } catch {
      // ignore preload failures; buildTreeSitterChunks will fall back upstream.
    }
    return buildTreeSitterChunks({ text, languageId, ext, options: fallbackOptions });
  } catch (err) {
    if (options?.log && !treeSitterState.loggedWorkerFailures.has('run')) {
      options.log(`[tree-sitter] Worker parse failed; falling back to main thread (${err?.message || err}).`);
      treeSitterState.loggedWorkerFailures.add('run');
    }
    try {
      await preloadTreeSitterLanguages([resolvedId], {
        log: options?.log,
        maxLoadedLanguages: options?.treeSitter?.maxLoadedLanguages
      });
    } catch {
      // ignore preload failures; buildTreeSitterChunks will fall back upstream.
    }
    return buildTreeSitterChunks({ text, languageId, ext, options: fallbackOptions });
  } finally {
    if (shouldRecordMetrics) {
      const durationMs = Date.now() - metricsStart;
      metricsCollector.add('treeSitter', resolvedId, lineCount, durationMs);
    }
  }
}

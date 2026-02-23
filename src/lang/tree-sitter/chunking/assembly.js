import { buildLineIndex, offsetToLine } from '../../../shared/lines.js';
import { extractDocComment, sliceSignature } from '../../shared.js';
import {
  COMMON_NAME_NODE_TYPES,
  getNamedChild,
  getNamedChildCount
} from '../ast.js';
import { treeSitterState } from '../state.js';
import {
  getTreeSitterChunkQuery,
  QUERY_CAPTURE_NAME,
  QUERY_MATCH_LIMIT_BUFFER
} from './planning.js';

const DEFAULT_MAX_AST_NODES = 250_000;
const DEFAULT_MAX_AST_STACK = 250_000;
const DEFAULT_MAX_CHUNK_NODES = 5_000;

const DEFAULT_NAME_SEARCH_MAX_DEPTH = 6;
const DEFAULT_NAME_SEARCH_MAX_NODES = 128;

/**
 * Build a cheap line accessor backed by line-start offsets.
 * @param {string} text
 * @param {number[]|null} lineIndex
 * @returns {{length:number,getLine:(idx:number)=>string}}
 */
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

/**
 * Extract compact one-line signature preview from declaration range.
 *
 * Signature extraction is intentionally defensive for malformed parser spans:
 * if `end` is very large or points past text length, the preview is still
 * clipped to a small prefix and normalized into one line.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
function extractSignature(text, start, end) {
  const limit = Math.min(end, start + 2000);
  const slice = text.slice(start, limit);

  let cutoff = slice.length;
  const newline = slice.indexOf('\n');
  if (newline >= 0 && newline < cutoff) cutoff = newline;
  const brace = slice.indexOf('{');
  if (brace >= 0 && brace < cutoff) cutoff = brace;
  const semi = slice.indexOf(';');
  if (semi >= 0 && semi < cutoff) cutoff = semi;
  const arrow = slice.indexOf('=>');
  if (arrow >= 0 && arrow + 2 < cutoff) cutoff = arrow + 2;

  const endIdx = start + cutoff;
  return sliceSignature(text, start, endIdx).replace(/\s+/g, ' ').trim();
}

/**
 * Find a likely identifier descendant for declaration naming.
 * @param {object} node
 * @param {object} config
 * @returns {object|null}
 */
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

/**
 * Slice raw source text for one AST node.
 *
 * Tree-sitter can surface recovery/missing nodes with unusual span metadata.
 * This helper rejects invalid or zero-width spans so downstream chunk metadata
 * cannot reference negative/NaN/out-of-range offsets.
 *
 * @param {object} node
 * @param {string} text
 * @returns {string}
 */
function sliceNodeText(node, text) {
  if (!node || typeof text !== 'string') return '';
  const start = Number(node.startIndex);
  const end = Number(node.endIndex);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '';
  if (start < 0 || end < 0 || end <= start || start > text.length) return '';
  return text.slice(start, Math.min(end, text.length));
}

/**
 * Resolve declaration name from language resolver, fields, or bounded BFS.
 *
 * Name extraction is best-effort: resolver and field access failures are
 * swallowed to keep chunking deterministic even when individual node kinds are
 * malformed or grammar-specific hooks throw.
 *
 * @param {object} node
 * @param {string} text
 * @param {object} config
 * @returns {string}
 */
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

/**
 * Find nearest ancestor considered a declaration/type node.
 * @param {object} node
 * @param {object} config
 * @returns {object|null}
 */
function findNearestType(node, config) {
  let current = node?.parent || null;
  while (current) {
    if (config.typeNodes.has(current.type)) return current;
    current = current.parent;
  }
  return null;
}

/**
 * Sort chunks by start offset only when traversal/query output is unsorted.
 *
 * Most grammars emit chunkable nodes in source order, so this fast path avoids
 * repeated O(n log n) sorts on already sorted lists.
 *
 * @param {Array<object>} chunks
 * @returns {void}
 */
const sortChunksByStartIfNeeded = (chunks) => {
  if (!Array.isArray(chunks) || chunks.length < 2) return;
  for (let i = 1; i < chunks.length; i += 1) {
    if (chunks[i - 1].start > chunks[i].start) {
      chunks.sort((a, b) => a.start - b.start);
      return;
    }
  }
};

/**
 * Traverse AST nodes and convert chunkable declarations under traversal budgets.
 *
 * Missing/recovery nodes are skipped to avoid producing chunks with unstable
 * spans. Budget overflows return `chunks: null` with a reason so callers can
 * preserve strict/fallback behavior without guessing.
 *
 * @param {object} root
 * @param {string} text
 * @param {object} config
 * @param {{maxAstNodes:number,maxAstStack:number,maxChunkNodes:number}} budget
 * @returns {{chunks:Array<object>|null,reason:string|null,visited:number,matched:number}}
 */
export function gatherChunkNodes(root, text, config, budget) {
  const chunks = [];
  const stack = [root];
  let visited = 0;
  let matched = 0;
  let lineIndex = null;
  let lineAccessor = null;
  const maxAstNodes = budget?.maxAstNodes ?? DEFAULT_MAX_AST_NODES;
  const maxAstStack = budget?.maxAstStack ?? DEFAULT_MAX_AST_STACK;
  const maxChunkNodes = budget?.maxChunkNodes ?? DEFAULT_MAX_CHUNK_NODES;

  const ensureLineAccessors = () => {
    if (!lineIndex) {
      lineIndex = buildLineIndex(text);
      lineAccessor = createLineAccessor(text, lineIndex);
    }
    return { lineIndex, lineAccessor };
  };

  while (stack.length) {
    if (stack.length > maxAstStack) {
      return { chunks: null, reason: 'maxAstStack', visited, matched };
    }
    const node = stack.pop();
    if (!node) continue;
    visited += 1;
    if (visited > maxAstNodes) {
      return { chunks: null, reason: 'maxAstNodes', visited, matched };
    }
    const missing = typeof node.isMissing === 'function' ? node.isMissing() : node.isMissing;
    if (missing) continue;
    if (config.typeNodes.has(node.type) || config.memberNodes.has(node.type)) {
      matched += 1;
      if (matched > maxChunkNodes) {
        return { chunks: null, reason: 'maxChunkNodes', visited, matched };
      }
      const { lineIndex: li, lineAccessor: la } = ensureLineAccessors();
      const chunk = toChunk(node, text, config, li, la);
      if (chunk) chunks.push(chunk);
    }
    const count = getNamedChildCount(node);
    for (let i = count - 1; i >= 0; i -= 1) {
      stack.push(getNamedChild(node, i));
    }
  }

  if (!chunks.length) return { chunks: [], reason: null, visited, matched };
  sortChunksByStartIfNeeded(chunks);
  return { chunks, reason: null, visited, matched };
}

/**
 * Attempt chunk extraction via tree-sitter query captures.
 *
 * Query captures are faster than full traversal but still validated against
 * chunk budgets. Capture order is normalized to ascending `start` offsets to
 * keep output deterministic across query engine implementations.
 *
 * @param {object} root
 * @param {string} text
 * @param {object} config
 * @param {{maxChunkNodes:number}} budget
 * @param {string} resolvedId
 * @param {object} options
 * @param {(key:string,amount?:number)=>void|null} [bumpMetric=null]
 * @returns {{chunks:Array<object>|null,reason:string|null,visited:number,matched:number,usedQuery:boolean,shouldFallback:boolean}|null}
 */
export function gatherChunksWithQuery(
  root,
  text,
  config,
  budget,
  resolvedId,
  options,
  bumpMetric = null
) {
  const query = getTreeSitterChunkQuery(resolvedId, config, options, bumpMetric);
  if (!query) return null;

  const maxChunkNodes = budget?.maxChunkNodes ?? DEFAULT_MAX_CHUNK_NODES;
  const matchLimit = Math.max(1, maxChunkNodes + QUERY_MATCH_LIMIT_BUFFER);
  let captures;
  try {
    captures = query.captures(root, undefined, undefined, { matchLimit });
  } catch (err) {
    if (typeof bumpMetric === 'function') bumpMetric('queryFailures', 1);
    if (options?.log && !treeSitterState.loggedQueryFailures?.has?.(resolvedId)) {
      options.log(`[tree-sitter] Query execution failed for ${resolvedId}: ${err?.message || err}.`);
      treeSitterState.loggedQueryFailures?.add?.(resolvedId);
    }
    return {
      chunks: null,
      reason: 'queryError',
      visited: 0,
      matched: 0,
      usedQuery: true,
      shouldFallback: true
    };
  }

  const exceeded = typeof query.didExceedMatchLimit === 'function' && query.didExceedMatchLimit();
  if (!Array.isArray(captures) || exceeded) {
    return {
      chunks: null,
      reason: 'maxChunkNodes',
      visited: 0,
      matched: 0,
      usedQuery: true,
      shouldFallback: true
    };
  }

  let lineIndex = null;
  let lineAccessor = null;
  const ensureLineAccessors = () => {
    if (!lineIndex) {
      lineIndex = buildLineIndex(text);
      lineAccessor = createLineAccessor(text, lineIndex);
    }
    return { lineIndex, lineAccessor };
  };

  const chunks = [];
  let matched = 0;
  for (const capture of captures) {
    if (!capture || capture.name !== QUERY_CAPTURE_NAME) continue;
    const node = capture.node;
    if (!node) continue;
    matched += 1;
    if (matched > maxChunkNodes) {
      return {
        chunks: null,
        reason: 'maxChunkNodes',
        visited: captures.length,
        matched,
        usedQuery: true,
        shouldFallback: true
      };
    }
    const { lineIndex: li, lineAccessor: la } = ensureLineAccessors();
    const chunk = toChunk(node, text, config, li, la);
    if (chunk) chunks.push(chunk);
  }

  if (!chunks.length) {
    return {
      chunks: [],
      reason: null,
      visited: captures.length,
      matched,
      usedQuery: true,
      shouldFallback: false
    };
  }

  sortChunksByStartIfNeeded(chunks);
  return {
    chunks,
    reason: null,
    visited: captures.length,
    matched,
    usedQuery: true,
    shouldFallback: false
  };
}

/**
 * Convert one AST node into chunk metadata.
 *
 * Returns `null` when the node cannot produce a stable name. This is expected
 * for anonymous constructs and malformed parser recovery nodes; callers should
 * treat `null` as "not chunkable" rather than an error.
 *
 * @param {object} node
 * @param {string} text
 * @param {object} config
 * @param {number[]} lineIndex
 * @param {{getLine:(idx:number)=>string}} lineAccessor
 * @returns {object|null}
 */
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

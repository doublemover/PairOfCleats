import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { extractDocComment, sliceSignature } from '../shared.js';
import {
  COMMON_NAME_NODE_TYPES,
  findDescendantByType,
  getNamedChild,
  getNamedChildCount
} from './ast.js';
import { LANG_CONFIG, LANGUAGE_GRAMMAR_KEYS } from './config.js';
import { isTreeSitterEnabled } from './options.js';
import { getNativeTreeSitterParser, loadNativeTreeSitterGrammar } from './native-runtime.js';
import { treeSitterState } from './state.js';
import { getTreeSitterWorkerPool, sanitizeTreeSitterOptions } from './worker.js';
import { buildLocalCacheKey } from '../../shared/cache-key.js';

const loggedParseFailures = new Set();
const loggedParseTimeouts = new Set();
const loggedSizeSkips = new Set();
const loggedUnavailable = new Set();
const loggedTraversalBudget = new Set();
const MAX_TIMEOUTS_PER_RUN = 3;

const bumpMetric = (key, amount = 1) => {
  if (!key) return;
  const metrics = treeSitterState.metrics;
  if (!metrics || typeof metrics !== 'object') return;
  const current = Number.isFinite(metrics[key]) ? metrics[key] : 0;
  metrics[key] = current + amount;
};

// Guardrails: keep tree traversal and chunk extraction bounded even on pathological inputs.
// These caps are intentionally conservative for JS/TS where nested lambdas/callbacks can be dense.
const DEFAULT_MAX_AST_NODES = 250_000;
const DEFAULT_MAX_AST_STACK = 250_000;
const DEFAULT_MAX_CHUNK_NODES = 5_000;

const JS_TS_LANGUAGE_IDS = new Set(['javascript', 'typescript', 'tsx', 'jsx']);
const QUERY_CAPTURE_NAME = 'chunk';
const QUERY_MATCH_LIMIT_BUFFER = 32;
const DEFAULT_DENSE_NODE_THRESHOLD = 250;
const DEFAULT_DENSER_NODE_THRESHOLD = 600;
const DEFAULT_DENSE_SCALE = 0.5;
const DEFAULT_DENSER_SCALE = 0.25;
const MIN_ADAPTIVE_AST_NODES = 10_000;
const MIN_ADAPTIVE_AST_STACK = 10_000;
const MIN_ADAPTIVE_CHUNK_NODES = 200;

const buildChunkQueryPattern = (language, config) => {
  if (!config) return null;
  const types = new Set();
  for (const entry of config.typeNodes || []) types.add(entry);
  for (const entry of config.memberNodes || []) types.add(entry);
  if (!types.size) return null;

  const filtered = [];
  const hasLookup = language && typeof language.idForNodeType === 'function';
  for (const type of types) {
    if (!hasLookup) {
      filtered.push(type);
      continue;
    }
    const typeId = language.idForNodeType(type, true);
    if (typeId !== null && typeId !== undefined) filtered.push(type);
  }

  if (!filtered.length) return null;
  return filtered.map((type) => `(${type}) @${QUERY_CAPTURE_NAME}`).join('\n');
};

const getTreeSitterChunkQuery = (languageId, config, options) => {
  if (!languageId || !config) return null;
  if (options?.treeSitter?.useQueries === false) return null;

  const cache = treeSitterState.queryCache;
  if (cache?.has?.(languageId)) {
    bumpMetric('queryHits', 1);
    return cache.get(languageId);
  }

  bumpMetric('queryMisses', 1);

  const languageEntry = treeSitterState.languageCache.get(languageId);
  const language = languageEntry?.language || null;
  if (!language || typeof language.query !== 'function') {
    cache?.set?.(languageId, null);
    return null;
  }

  const pattern = buildChunkQueryPattern(language, config);
  if (!pattern) {
    cache?.set?.(languageId, null);
    return null;
  }

  try {
    const query = language.query(pattern);
    cache?.set?.(languageId, query);
    bumpMetric('queryBuilds', 1);
    return query;
  } catch (err) {
    cache?.set?.(languageId, null);
    bumpMetric('queryFailures', 1);
    if (options?.log && !treeSitterState.loggedQueryFailures?.has?.(languageId)) {
      options.log(`[tree-sitter] Query compile failed for ${languageId}: ${err?.message || err}.`);
      treeSitterState.loggedQueryFailures?.add?.(languageId);
    }
    return null;
  }
};

const resolveAdaptiveBudgetScale = (options, resolvedId) => {
  const adaptive = options?.treeSitter?.adaptive;
  if (adaptive === false || adaptive?.enabled === false) return { scale: 1, density: null };
  const entry = treeSitterState.nodeDensity?.get?.(resolvedId);
  const density = entry && typeof entry === 'object' ? entry.density : entry;
  if (!Number.isFinite(density) || density <= 0) return { scale: 1, density: null };

  const denseThreshold = Number.isFinite(adaptive?.denseThreshold)
    ? adaptive.denseThreshold
    : DEFAULT_DENSE_NODE_THRESHOLD;
  const denserThreshold = Number.isFinite(adaptive?.denserThreshold)
    ? adaptive.denserThreshold
    : DEFAULT_DENSER_NODE_THRESHOLD;
  const denseScale = Number.isFinite(adaptive?.denseScale)
    ? adaptive.denseScale
    : DEFAULT_DENSE_SCALE;
  const denserScale = Number.isFinite(adaptive?.denserScale)
    ? adaptive.denserScale
    : DEFAULT_DENSER_SCALE;

  let scale = 1;
  if (Number.isFinite(denserThreshold) && density >= denserThreshold) {
    scale = denserScale;
  } else if (Number.isFinite(denseThreshold) && density >= denseThreshold) {
    scale = denseScale;
  }

  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  if (scale < 1 && options?.log && !treeSitterState.loggedAdaptiveBudgets?.has?.(resolvedId)) {
    options.log(
      `[tree-sitter] Dense AST for ${resolvedId} (${density.toFixed(1)} nodes/line); ` +
      `scaling traversal budgets by ${scale}.`
    );
    treeSitterState.loggedAdaptiveBudgets?.add?.(resolvedId);
  }

  return { scale, density };
};

const applyAdaptiveBudget = (budget, options, resolvedId) => {
  const { scale } = resolveAdaptiveBudgetScale(options, resolvedId);
  if (!Number.isFinite(scale) || scale >= 1) return budget;
  bumpMetric('adaptiveBudgetCuts', 1);
  const clamp = (value, min) => {
    const base = Number.isFinite(value) ? value : min;
    const scaled = Math.floor(base * scale);
    const floor = Math.min(base, min);
    return Math.max(floor, scaled);
  };
  return {
    maxAstNodes: clamp(budget.maxAstNodes, MIN_ADAPTIVE_AST_NODES),
    maxAstStack: clamp(budget.maxAstStack, MIN_ADAPTIVE_AST_STACK),
    maxChunkNodes: clamp(budget.maxChunkNodes, MIN_ADAPTIVE_CHUNK_NODES)
  };
};

const recordNodeDensity = (languageId, visited, lineCount) => {
  if (!languageId) return null;
  if (!Number.isFinite(visited) || visited <= 0) return null;
  if (!Number.isFinite(lineCount) || lineCount <= 0) return null;
  const density = visited / Math.max(1, lineCount);
  const prev = treeSitterState.nodeDensity?.get?.(languageId);
  const prevDensity = prev && typeof prev === 'object' ? prev.density : prev;
  const prevSamples = prev && typeof prev === 'object' ? prev.samples : 0;
  const nextDensity = Number.isFinite(prevDensity)
    ? (prevDensity * 0.7) + (density * 0.3)
    : density;
  const next = { density: nextDensity, samples: prevSamples + 1 };
  treeSitterState.nodeDensity?.set?.(languageId, next);
  return next;
};

function resolveTraversalBudget(options, resolvedId) {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.[resolvedId] || {};
  const isJsTs = JS_TS_LANGUAGE_IDS.has(resolvedId);
  const defaultMaxChunkNodes = isJsTs ? 1_000 : DEFAULT_MAX_CHUNK_NODES;
  const maxAstNodes = perLanguage.maxAstNodes ?? config.maxAstNodes ?? DEFAULT_MAX_AST_NODES;
  const maxAstStack = perLanguage.maxAstStack ?? config.maxAstStack ?? DEFAULT_MAX_AST_STACK;
  const maxChunkNodes = perLanguage.maxChunkNodes ?? config.maxChunkNodes ?? defaultMaxChunkNodes;
  const budget = {
    maxAstNodes: Number.isFinite(maxAstNodes) && maxAstNodes > 0 ? Math.floor(maxAstNodes) : DEFAULT_MAX_AST_NODES,
    maxAstStack: Number.isFinite(maxAstStack) && maxAstStack > 0 ? Math.floor(maxAstStack) : DEFAULT_MAX_AST_STACK,
    maxChunkNodes: Number.isFinite(maxChunkNodes) && maxChunkNodes > 0 ? Math.floor(maxChunkNodes) : defaultMaxChunkNodes
  };
  return applyAdaptiveBudget(budget, options, resolvedId);
}

const DEFAULT_CHUNK_CACHE_MAX_ENTRIES = 64;

const buildChunkCacheSignature = (options, resolvedId) => {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.[resolvedId] || {};
  const adaptiveRaw = config.adaptive;
  const adaptive = adaptiveRaw === false || adaptiveRaw?.enabled === false
    ? false
    : adaptiveRaw && typeof adaptiveRaw === 'object'
      ? {
        denseThreshold: adaptiveRaw.denseThreshold ?? null,
        denserThreshold: adaptiveRaw.denserThreshold ?? null,
        denseScale: adaptiveRaw.denseScale ?? null,
        denserScale: adaptiveRaw.denserScale ?? null
      }
      : null;

  // Keep this signature small but output-sensitive: if any of these knobs change,
  // chunk boundaries/names can change (or tree-sitter may fall back).
  return {
    useQueries: config.useQueries ?? null,
    maxBytes: perLanguage.maxBytes ?? config.maxBytes ?? null,
    maxLines: perLanguage.maxLines ?? config.maxLines ?? null,
    maxParseMs: perLanguage.maxParseMs ?? config.maxParseMs ?? null,
    maxAstNodes: perLanguage.maxAstNodes ?? config.maxAstNodes ?? null,
    maxAstStack: perLanguage.maxAstStack ?? config.maxAstStack ?? null,
    maxChunkNodes: perLanguage.maxChunkNodes ?? config.maxChunkNodes ?? null,
    adaptive,
    configChunking: config.configChunking === true
  };
};

const resolveChunkCacheKey = (options, resolvedId) => {
  if (options?.treeSitter?.chunkCache === false) return null;
  const rawKey = options?.treeSitterCacheKey ?? options?.treeSitter?.cacheKey ?? null;
  if (rawKey == null || rawKey === '') return null;
  const base = typeof rawKey === 'string' ? rawKey : String(rawKey);
  if (!base) return null;
  return buildLocalCacheKey({
    namespace: 'tree-sitter-chunk',
    payload: {
      languageId: resolvedId,
      key: base,
      signature: buildChunkCacheSignature(options, resolvedId)
    }
  }).key;
};

const resolveChunkCacheMaxEntries = (options) => {
  const raw = options?.treeSitter?.chunkCacheMaxEntries
    ?? options?.treeSitter?.chunkCache?.maxEntries
    ?? DEFAULT_CHUNK_CACHE_MAX_ENTRIES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CHUNK_CACHE_MAX_ENTRIES;
  return Math.max(1, Math.floor(parsed));
};

const ensureChunkCache = (options) => {
  const maxEntries = resolveChunkCacheMaxEntries(options);
  if (!treeSitterState.chunkCache) treeSitterState.chunkCache = new Map();
  if (treeSitterState.chunkCacheMaxEntries !== maxEntries) {
    treeSitterState.chunkCache.clear();
    treeSitterState.chunkCacheMaxEntries = maxEntries;
  }
  return { cache: treeSitterState.chunkCache, maxEntries };
};

const cloneChunkList = (chunks) => chunks.map((chunk) => ({
  ...chunk,
  ...(chunk?.meta ? { meta: { ...chunk.meta } } : {})
}));

const getCachedChunks = (cache, key) => {
  if (!cache?.has?.(key)) {
    bumpMetric('chunkCacheMisses', 1);
    return null;
  }
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  bumpMetric('chunkCacheHits', 1);
  return Array.isArray(value) ? cloneChunkList(value) : null;
};

const setCachedChunks = (cache, key, chunks, maxEntries) => {
  if (!Array.isArray(chunks) || !chunks.length) return;
  bumpMetric('chunkCacheSets', 1);
  cache.set(key, cloneChunkList(chunks));
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
    bumpMetric('chunkCacheEvictions', 1);
  }
};

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

function gatherChunkNodes(root, text, config, budget) {
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
  chunks.sort((a, b) => a.start - b.start);
  return { chunks, reason: null, visited, matched };
}

function gatherChunksWithQuery(root, text, config, budget, resolvedId, options) {
  const query = getTreeSitterChunkQuery(resolvedId, config, options);
  if (!query) return null;

  const maxChunkNodes = budget?.maxChunkNodes ?? DEFAULT_MAX_CHUNK_NODES;
  const matchLimit = Math.max(1, maxChunkNodes + QUERY_MATCH_LIMIT_BUFFER);
  let captures;
  try {
    captures = query.captures(root, undefined, undefined, { matchLimit });
  } catch (err) {
    bumpMetric('queryFailures', 1);
    if (options?.log && !treeSitterState.loggedQueryFailures?.has?.(resolvedId)) {
      options.log(`[tree-sitter] Query execution failed for ${resolvedId}: ${err?.message || err}.`);
      treeSitterState.loggedQueryFailures?.add?.(resolvedId);
    }
    return { chunks: null, reason: 'queryError', visited: 0, matched: 0, usedQuery: true, shouldFallback: true };
  }

  const exceeded = typeof query.didExceedMatchLimit === 'function' && query.didExceedMatchLimit();
  if (!Array.isArray(captures) || exceeded) {
    return { chunks: null, reason: 'maxChunkNodes', visited: 0, matched: 0, usedQuery: true, shouldFallback: true };
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
      return { chunks: null, reason: 'maxChunkNodes', visited: captures.length, matched, usedQuery: true, shouldFallback: true };
    }
    const { lineIndex: li, lineAccessor: la } = ensureLineAccessors();
    const chunk = toChunk(node, text, config, li, la);
    if (chunk) chunks.push(chunk);
  }

  if (!chunks.length) {
    return { chunks: [], reason: null, visited: captures.length, matched, usedQuery: true, shouldFallback: false };
  }
  chunks.sort((a, b) => a.start - b.start);
  return { chunks, reason: null, visited: captures.length, matched, usedQuery: true, shouldFallback: false };
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
  const strict = options?.treeSitter?.strict === true;
  const failStrict = (reason, message, extra = {}) => {
    if (!strict) return null;
    const err = new Error(message);
    err.code = 'ERR_TREE_SITTER_STRICT';
    err.reason = reason;
    err.languageId = resolvedId;
    Object.assign(err, extra);
    throw err;
  };
  const buildWholeFileChunk = () => ([{
    start: 0,
    end: text.length,
    name: 'file',
    kind: 'File',
    meta: { treeSitter: true, wholeFile: true }
  }]);
  if (treeSitterState.disabledLanguages?.has(resolvedId)) {
    bumpMetric('fallbacks', 1);
    return failStrict(
      'disabled',
      `Tree-sitter disabled for ${resolvedId}; strict mode does not allow fallback.`
    );
  }
  if (exceedsTreeSitterLimits(text, options, resolvedId)) return null;
  const metricsCollector = options?.metricsCollector;
  const shouldRecordMetrics = metricsCollector && typeof metricsCollector.add === 'function';
  const shouldTrackDensity = options?.treeSitter?.adaptive !== false;
  const lineCount = (shouldRecordMetrics || shouldTrackDensity) ? countLines(text) : 0;
  const metricsStart = shouldRecordMetrics ? Date.now() : 0;
  const recordMetrics = () => {
    if (!shouldRecordMetrics) return;
    const durationMs = Date.now() - metricsStart;
    metricsCollector.add('treeSitter', resolvedId, lineCount, durationMs);
  };
  const cacheKey = resolveChunkCacheKey(options, resolvedId);
  const cacheRef = cacheKey ? ensureChunkCache(options) : null;
  if (cacheKey && cacheRef) {
    const cached = getCachedChunks(cacheRef.cache, cacheKey);
    if (cached) {
      recordMetrics();
      return cached;
    }
  }
  const shouldDeferMissing = options?.treeSitterMissingLanguages
    && options?.treeSitter?.deferMissing !== false;
  const parser = getNativeTreeSitterParser(resolvedId, options);
  if (!parser) {
    if (shouldDeferMissing) {
      options.treeSitterMissingLanguages.add(resolvedId);
      bumpMetric('fallbacks', 1);
      return null;
    }
    if (options?.treeSitterMissingLanguages) {
      options.treeSitterMissingLanguages.add(resolvedId);
    }
    bumpMetric('fallbacks', 1);
    if (strict) {
      return failStrict(
        'missing-parser',
        `Tree-sitter unavailable for ${resolvedId}; strict mode does not allow fallback.`
      );
    }
    if (options?.log && !loggedUnavailable.has(resolvedId)) {
      options.log(`Tree-sitter unavailable for ${resolvedId}; falling back to heuristic chunking.`);
      loggedUnavailable.add(resolvedId);
    }
    return null;
  }
  const loadedGrammar = loadNativeTreeSitterGrammar(resolvedId);
  const grammarLanguage = loadedGrammar?.language || null;
  if (grammarLanguage) {
    treeSitterState.languageCache?.set?.(resolvedId, { language: grammarLanguage, error: null });
    const grammarKey = LANGUAGE_GRAMMAR_KEYS?.[resolvedId];
    if (grammarKey) {
      treeSitterState.grammarCache?.set?.(grammarKey, { language: grammarLanguage, error: null });
    }
  }
  const config = LANG_CONFIG[resolvedId];
  if (!config) {
    bumpMetric('fallbacks', 1);
    if (strict) {
      return failStrict(
        'missing-config',
        `Tree-sitter config missing for ${resolvedId}; strict mode does not allow fallback.`
      );
    }
    return null;
  }
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
        bumpMetric('parseTimeouts', 1);
        bumpMetric('fallbacks', 1);
        if (strict) {
          return failStrict(
            'timeout',
            `Tree-sitter parse timed out for ${resolvedId}; strict mode does not allow fallback.`,
            { parseError: message }
          );
        }
        if (options?.log && !loggedParseTimeouts.has(resolvedId)) {
          options.log(`Tree-sitter parse timed out for ${resolvedId}; falling back to heuristic chunking.`);
          loggedParseTimeouts.add(resolvedId);
        }
        const counts = treeSitterState.timeoutCounts;
        if (counts) {
          const nextCount = (counts.get(resolvedId) || 0) + 1;
          counts.set(resolvedId, nextCount);
          if (nextCount >= MAX_TIMEOUTS_PER_RUN && treeSitterState.disabledLanguages) {
            treeSitterState.disabledLanguages.add(resolvedId);
            if (options?.log && !treeSitterState.loggedTimeoutDisable?.has(resolvedId)) {
              options.log(
                `Tree-sitter disabled for ${resolvedId} after ${nextCount} timeouts; ` +
                'using heuristic chunking for the remainder of this run.'
              );
              treeSitterState.loggedTimeoutDisable?.add?.(resolvedId);
            }
          }
        }
        return null;
      }
      bumpMetric('parseFailures', 1);
      bumpMetric('fallbacks', 1);
      if (strict) {
        return failStrict(
          'parse-failed',
          `Tree-sitter parse failed for ${resolvedId}; strict mode does not allow fallback.`,
          { parseError: message }
        );
      }
      return null;
    }

    let rootNode = null;
    try {
      rootNode = tree.rootNode;
    } catch {
      recordMetrics();
      bumpMetric('parseFailures', 1);
      bumpMetric('fallbacks', 1);
      if (strict) {
        return failStrict(
          'parse-failed',
          `Tree-sitter parse failed for ${resolvedId}; strict mode does not allow fallback.`
        );
      }
      if (!loggedParseFailures.has(resolvedId) && options?.log) {
        options.log(`Tree-sitter parse failed for ${resolvedId}; falling back to heuristic chunking.`);
        loggedParseFailures.add(resolvedId);
      }
      return null;
    }

    let queryResult = null;
    try {
      queryResult = gatherChunksWithQuery(rootNode, text, config, traversalBudget, resolvedId, options);
    } catch {
      queryResult = null;
    }

    if (queryResult?.usedQuery) {
      if (Array.isArray(queryResult.chunks) && queryResult.chunks.length) {
        if (cacheKey && cacheRef) {
          setCachedChunks(cacheRef.cache, cacheKey, queryResult.chunks, cacheRef.maxEntries);
        }
        recordMetrics();
        return queryResult.chunks;
      }
      if (!queryResult.shouldFallback) {
        recordMetrics();
        bumpMetric('fallbacks', 1);
        if (strict) {
          // A query can legitimately match no "chunkable" nodes (e.g. tiny files).
          // In strict mode, avoid falling back to heuristics by emitting one whole-file chunk.
          return buildWholeFileChunk();
        }
        return null;
      }
      if (queryResult.reason && options?.log) {
        const key = `query:${resolvedId}:${queryResult.reason}`;
        if (!loggedTraversalBudget.has(key)) {
          const fallbackLabel = strict
            ? 'Falling back to traversal chunking.'
            : 'Falling back to heuristic chunking.';
          options.log(
            `Tree-sitter query aborted for ${resolvedId} (${queryResult.reason}); ` +
            `visited=${queryResult.visited ?? 'n/a'} matched=${queryResult.matched ?? 'n/a'}. ` +
            fallbackLabel
          );
          loggedTraversalBudget.add(key);
        }
      }
    }

    let traversalResult = null;
    try {
      traversalResult = gatherChunkNodes(rootNode, text, config, traversalBudget);
      if (shouldTrackDensity && traversalResult?.visited) {
        recordNodeDensity(resolvedId, traversalResult.visited, lineCount);
      }
      if (!traversalResult?.chunks) {
        recordMetrics();
        bumpMetric('fallbacks', 1);
        if (strict) {
          // Traversal budgets can abort on dense ASTs. In strict mode, emit a
          // whole-file chunk rather than falling back to heuristics.
          return buildWholeFileChunk();
        }
        const key = `${resolvedId}:${traversalResult?.reason || 'budget'}`;
        if (options?.log && !loggedTraversalBudget.has(key)) {
          options.log(
            `Tree-sitter traversal aborted for ${resolvedId} (${traversalResult?.reason}); `
              + `visited=${traversalResult?.visited ?? 'n/a'} matched=${traversalResult?.matched ?? 'n/a'}. `
              + 'Falling back to heuristic chunking.'
          );
          loggedTraversalBudget.add(key);
        }
        return null;
      }
    } catch {
      recordMetrics();
      bumpMetric('parseFailures', 1);
      bumpMetric('fallbacks', 1);
      if (strict) {
        return failStrict(
          'parse-failed',
          `Tree-sitter parse failed for ${resolvedId}; strict mode does not allow fallback.`
        );
      }
      if (!loggedParseFailures.has(resolvedId) && options?.log) {
        options.log(`Tree-sitter parse failed for ${resolvedId}; falling back to heuristic chunking.`);
        loggedParseFailures.add(resolvedId);
      }
      return null;
    }

    if (!traversalResult.chunks.length) {
      recordMetrics();
      bumpMetric('fallbacks', 1);
      if (strict) {
        return buildWholeFileChunk();
      }
      return null;
    }

    if (cacheKey && cacheRef) {
      setCachedChunks(cacheRef.cache, cacheKey, traversalResult.chunks, cacheRef.maxEntries);
    }
    recordMetrics();
    return traversalResult.chunks;
  } finally {
    // Tree objects can retain sizable parser-side allocations and should be
    // explicitly released after chunk extraction.
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
  if (treeSitterState.disabledLanguages?.has(resolvedId)) return null;
  if (exceedsTreeSitterLimits(text, options, resolvedId)) return null;
  if (!LANG_CONFIG[resolvedId]) return null;

  const cacheKey = resolveChunkCacheKey(options, resolvedId);
  const cacheRef = cacheKey ? ensureChunkCache(options) : null;
  if (cacheKey && cacheRef) {
    const cached = getCachedChunks(cacheRef.cache, cacheKey);
    if (cached) return cached;
  }

  const pool = await getTreeSitterWorkerPool(options?.treeSitter?.worker, options);
  if (!pool) {
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
    if (Array.isArray(result) && result.length) {
      if (cacheKey && cacheRef) {
        setCachedChunks(cacheRef.cache, cacheKey, result, cacheRef.maxEntries);
      }
      return result;
    }

    // Null/empty results from a worker are treated as a failure signal; retry in-thread for determinism.
    bumpMetric('workerFallbacks', 1);
    return buildTreeSitterChunks({ text, languageId, ext, options: fallbackOptions });
  } catch (err) {
    if (options?.log && !treeSitterState.loggedWorkerFailures.has('run')) {
      options.log(`[tree-sitter] Worker parse failed; falling back to main thread (${err?.message || err}).`);
      treeSitterState.loggedWorkerFailures.add('run');
    }
    bumpMetric('workerFallbacks', 1);
    return buildTreeSitterChunks({ text, languageId, ext, options: fallbackOptions });
  } finally {
    if (shouldRecordMetrics) {
      const durationMs = Date.now() - metricsStart;
      metricsCollector.add('treeSitter', resolvedId, lineCount, durationMs);
    }
  }
}

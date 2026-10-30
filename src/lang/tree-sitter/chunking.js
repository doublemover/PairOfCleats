import { buildLineIndex, countLines, createLineAccessor, offsetToLine } from '../../shared/lines.js';
import { extractDocComment, sliceSignature } from '../shared.js';
import { findDeclarationBoundary } from '../shared/declaration-boundary.js';
import {
  findDescendantByType,
  getNamedChild,
  getNamedChildCount
} from './ast.js';
import { LANG_CONFIG, LANGUAGE_GRAMMAR_KEYS } from './config.js';
import { resolveDeclarationPrefixRange } from './declaration-roles.js';
import { callableGrammarMetadata } from './declaration-metadata.js';
import { attachSyntaxCallFacts } from './call-facts.js';
import { isTreeSitterEnabled } from './options.js';
import { getNativeTreeSitterParser, getNativeTreeSitterIdentity, loadNativeTreeSitterGrammar } from './native-runtime.js';
import { attachNativeLeafProduct, NATIVE_LEAF_PRODUCT_LIMITS } from './leaf-product.js';
import { getContainedFileSession } from '../../shared/contained-file-resource.js';
import { resolveTreeSitterLanguageForExt } from './language-id.js';
import { treeSitterState } from './state.js';
import { currentRunResourceScope } from '../../shared/lifecycle/run-scope.js';
import { isAbortError, throwIfAborted } from '../../shared/abort.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { getTreeSitterWorkerPool, sanitizeTreeSitterOptions } from './worker.js';
import { recordNodeDensity, resolveTraversalBudget } from './chunking/budget.js';
import { createNativeProjectionWork, isNativeProjectionBudgetFailure } from './chunking/projection-work.js';
import { createNativeProjectionNames, isNativeSemanticTypeKind } from './chunking/projection-names.js';
import {
  ensureChunkCache,
  loadCachedChunks,
  resolveChunkCacheKey,
  resolvePersistentChunkCacheRoot,
  storeCachedChunks
} from './chunking/cache.js';

const loggedParseFailures = new Set();
const loggedParseTimeouts = new Set();
const loggedSizeSkips = new Set();
const loggedUnavailable = new Set();
const loggedTraversalBudget = new Set();
const loggedPlatformGuards = new Set();
const MAX_TIMEOUTS_PER_RUN = 3;

// The current Groovy grammar rejects some legal semicolon-free statements.
// Keep useful recovered declaration chunks, but never imply full syntax
// coverage or treat a recovery node as proof that the source is invalid.
const withParserCoverage = (chunks, languageId, parserRecovered = null) => {
  if (languageId !== 'groovy' || !Array.isArray(chunks)) return chunks;
  return chunks.map((chunk) => ({
    ...chunk,
    meta: {
      ...chunk.meta,
      parserCoverage: 'partial',
      parserRecovered: typeof parserRecovered === 'boolean'
        ? parserRecovered
        : (typeof chunk.meta?.parserRecovered === 'boolean' ? chunk.meta.parserRecovered : null)
    }
  }));
};

/**
 * Increment tree-sitter metric counters when metrics state is enabled.
 * @param {string} key
 * @param {number} [amount=1]
 * @returns {void}
 */
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

const QUERY_CAPTURE_NAME = 'chunk';
const QUERY_MATCH_LIMIT_BUFFER = 32;

/**
 * Build the declaration/member capture query for one language config.
 * @param {object|null} language
 * @param {object|null} config
 * @returns {string|null}
 */
const buildChunkQueryPattern = (language, config) => {
  if (!config) return null;
  const types = new Set();
  for (const entry of config.typeNodes || []) types.add(entry);
  for (const entry of config.memberNodes || []) types.add(entry);
  if (!types.size) return null;

  const filtered = [];
  const hasLookup = language && typeof language.idForNodeType === 'function';
  const nativeTypes = Array.isArray(language?.nodeTypeInfo)
    ? new Set(language.nodeTypeInfo.filter(node => node.named).map(node => node.type)) : null;
  for (const type of types) {
    if (!hasLookup && (!nativeTypes || nativeTypes.has(type))) {
      filtered.push(type);
      continue;
    }
    if (!hasLookup) continue;
    const typeId = language.idForNodeType(type, true);
    if (typeId !== null && typeId !== undefined) filtered.push(type);
  }

  if (!filtered.length) return null;
  return filtered.map((type) => config.queryPatterns?.[type] || `(${type}) @${QUERY_CAPTURE_NAME}`).join('\n');
};

/**
 * Resolve compiled query for chunk extraction and memoize the result.
 * @param {string} languageId
 * @param {object} config
 * @param {object} options
 * @returns {object|null}
 */
const getTreeSitterChunkQuery = (languageId, config, options, parser) => {
  if (!languageId || !config) return null;
  if (options?.treeSitter?.useQueries === false) return null;

  const cache = treeSitterState.queryCache;
  const language = loadNativeTreeSitterGrammar(languageId, { log: options?.log }).language;
  const Query = parser?.constructor?.Query;
  const pattern = buildChunkQueryPattern(language, config);
  const cacheKey = `native:${languageId}`;
  const cached = cache?.get?.(cacheKey);
  if (cached?.language === language && cached.runtime === parser?.constructor && cached.pattern === pattern) {
    bumpMetric('queryHits', 1);
    return cached.query;
  }

  bumpMetric('queryMisses', 1);

  const remember = query => cache?.set?.(cacheKey, { language, runtime: parser?.constructor, pattern, query,
    delete: () => query?.delete?.() });
  if (!language || typeof Query !== 'function' || !pattern) {
    remember(null);
    return null;
  }

  try {
    const query = new Query(language, pattern);
    remember(query);
    bumpMetric('queryBuilds', 1);
    return query;
  } catch (err) {
    remember(null);
    bumpMetric('queryFailures', 1);
    if (options?.log && !treeSitterState.loggedQueryFailures?.has?.(languageId)) {
      options.log(`[tree-sitter] Query compile failed for ${languageId}: ${err?.message || err}.`);
      treeSitterState.loggedQueryFailures?.add?.(languageId);
    }
    return null;
  }
};

/**
 * Apply per-language max-byte/max-line guards before parsing.
 * @param {string} text
 * @param {object} options
 * @param {string} resolvedId
 * @returns {boolean}
 */
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

/**
 * Resolve parse timeout configuration in milliseconds.
 * @param {object} options
 * @param {string} resolvedId
 * @returns {number|null}
 */
function resolveParseTimeoutMs(options, resolvedId) {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.[resolvedId] || {};
  const raw = perLanguage.maxParseMs ?? config.maxParseMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

/**
 * Retain an explicit diagnostic guard; the required patched Perl scanner and
 * Tree-sitter worker lifecycle now qualify the normal Windows parser route.
 * @param {string} resolvedId
 * @param {object} [options={}]
 * @returns {boolean}
 */
const shouldGuardNativeParser = (resolvedId, options = {}) => {
  if (resolvedId !== 'perl') return false;
  const configured = options?.treeSitter?.nativeParserGuards?.perl;
  if (configured === false) return false;
  if (configured === true) return true;
  return false;
};

/**
 * Extract compact one-line signature preview from declaration range.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
export function extractSignature(text, start, end, node = null, { ecmaScriptLineTerminators = false } = {}) {
  const limit = Math.min(end, start + 2000);
  let body = null;
  try { body = node?.childForFieldName?.('body'); } catch (error) {
    if (isNativeProjectionBudgetFailure(error) || isAbortError(error) || getContainedFileSession(error)) throw error;
    observeStorageResource(error, { phase: 'native-projection-signature' }).requireSettled();
  }
  if (!body) {
    for (let index = 0; index < getNamedChildCount(node); index += 1) {
      const child = getNamedChild(node, index);
      if (['statement_block', 'class_body', 'declaration_list', 'function_body', 'block'].includes(child?.type)) {
        body = child; break;
      }
    }
  }
  const boundary = findDeclarationBoundary(text.slice(start, limit), 0, {
    maxChars: 2000, rustLifetimes: /\bfn\b/.test(text.slice(start, start + 80)),
    tripleDoubleStrings: true, ecmaScriptLineTerminators
  });
  const endIdx = Number.isInteger(body?.startIndex) && body.startIndex >= start && body.startIndex <= end
    ? Math.min(limit, body.startIndex) : start + boundary.signatureEnd;
  return sliceSignature(text, start, endIdx).replace(/\s+/g, ' ').trim();
}

/**
 * Traverse AST nodes and convert chunkable declarations under traversal budgets.
 * @param {object} root
 * @param {string} text
 * @param {object} config
 * @param {{maxAstNodes:number,maxAstStack:number,maxChunkNodes:number}} budget
 * @returns {{chunks:Array<object>|null,reason:string|null,visited:number,matched:number}}
 */
function gatherChunkNodes(root, text, config, budget, projection, query = null) {
  const { work, names } = projection, chunks = [], stack = [work.view(root)];
  let visited = 0, matched = 0, lineIndex = null, lineAccessor = null;
  work.reserve(1);
  try {
    while (stack.length) {
      work.spend('visits'); visited++;
      const node = stack.pop(); work.release(1); if (!node) continue;
      const missing = typeof node.isMissing === 'function' ? node.isMissing() : node.isMissing;
      if (missing) continue;
      if ((config.typeNodes.has(node.type) || config.memberNodes.has(node.type))
        && (!config.includeNode || work.project(() => config.includeNode(node)))) {
        let selected = [node];
        if (query) {
          work.spend('queryExecutions'); bumpMetric('queryExecutions', 1);
          // Native query roots are restricted to this already-admitted node.
          // Generated patterns have one root capture; never materialize a
          // full-file native capture array before applying JS admission.
          const captures = query.captures(work.raw(node), { maxStartDepth: 0,
            matchLimit: Math.max(1, budget.maxChunkNodes + QUERY_MATCH_LIMIT_BUFFER) });
          if (!Array.isArray(captures) || query.didExceedMatchLimit?.()) work.fail('maxChunkNodes');
          if (captures.length > config.typeNodes.size + config.memberNodes.size) work.fail('queryCaptureExtent');
          selected = captures.filter(capture => capture?.name === QUERY_CAPTURE_NAME).map(capture => {
            if (capture.node.startIndex !== node.startIndex || capture.node.endIndex !== node.endIndex) {
              throw new Error('Native root query returned a descendant capture.');
            }
            return work.view(capture.node);
          });
        }
        for (const candidate of selected) {
          matched++;
          if (matched > budget.maxChunkNodes) work.fail('maxChunkNodes');
          if (!lineIndex) { lineIndex = buildLineIndex(text); lineAccessor = createLineAccessor(text, lineIndex); }
          const chunk = work.project(() => toChunk(candidate, text, config, lineIndex, lineAccessor, names));
          if (chunk) { work.output(chunk); chunks.push(chunk); }
        }
      }
      const count = getNamedChildCount(node);
      // Preserve existing pre-expansion guards; nested projection shares work.
      if (count > budget.maxAstStack - stack.length) work.fail('maxAstStack');
      if (count > budget.maxAstNodes - visited - stack.length) work.fail('maxAstNodes');
      work.reserve(count); let reserved = count;
      try { for (let index = count - 1; index >= 0; index--) { stack.push(getNamedChild(node, index)); reserved--; } }
      finally { if (reserved) work.release(reserved); }
    }
    chunks.sort((a, b) => a.start - b.start);
    return { chunks, reason: null, visited, matched };
  } finally { if (stack.length) work.release(stack.length); }
}

function gatherChunksWithQuery(root, text, config, budget, resolvedId, options, projection, parser) {
  const query = getTreeSitterChunkQuery(resolvedId, config, options, parser);
  if (!query) return null;
  try {
    return { ...gatherChunkNodes(root, text, config, budget, projection, query), usedQuery: true, shouldFallback: false };
  } catch (error) {
    if (isNativeProjectionBudgetFailure(error) || isAbortError(error) || getContainedFileSession(error)) throw error;
    observeStorageResource(error, { phase: 'native-projection-query' }).requireSettled();
    bumpMetric('queryFailures', 1);
    if (options?.log && !treeSitterState.loggedQueryFailures?.has?.(resolvedId)) {
      options.log('[tree-sitter] Query execution failed for ' + resolvedId + ': ' + (error?.message || error) + '.');
      treeSitterState.loggedQueryFailures?.add?.(resolvedId);
    }
    return { chunks: null, reason: 'queryError', visited: projection.work.snapshot().visits,
      matched: 0, usedQuery: true, shouldFallback: true };
  }
}

/**
 * Convert one AST node into chunk metadata.
 * @param {object} node
 * @param {string} text
 * @param {object} config
 * @param {number[]} lineIndex
 * @param {{getLine:(idx:number)=>string}} lineAccessor
 * @returns {object|null}
 */
function toChunk(node, text, config, lineIndex, lineAccessor, names) {
  const name = names.name(node);
  if (!name) return null;
  let kind = config.kindMap[node.type] || 'Declaration';
  if (typeof config.resolveKind === 'function') {
    kind = config.resolveKind(node, kind, text) || kind;
  }
  const declaration = config.resolveDeclaration?.(node, text);
  const range = declaration?.range || config.resolveRange?.(node, text) || resolveDeclarationPrefixRange(node);
  const start = range?.start ?? node.startIndex;
  const end = range?.end ?? node.endIndex;
  const scopes = names.scopes(node);
  const nearest = scopes[0];
  let fullName = [...scopes].reverse().map(scope => scope.name).concat(name).join('.');
  const lexicalPrefix = [...scopes].reverse().map(scope => scope.name).join('.');
  if (lexicalPrefix && name.startsWith(`${lexicalPrefix}.`)) fullName = name;
  fullName = config.resolveQualifiedName?.(node,name,scopes,text) || fullName;
  let finalKind = kind;
  if (nearest && config.memberNodes.has(node.type)) {
    const isTypeMember = !nearest.member && isNativeSemanticTypeKind(nearest.kind);
    if (kind === 'FunctionDeclaration' && isTypeMember) finalKind = 'MethodDeclaration';
  }
  if (!scopes.length && config.memberNodes.has(node.type)
    && typeof config.resolveMemberName === 'function') {
    const resolved = config.resolveMemberName(node, name, text);
    if (resolved?.name) fullName = resolved.name;
    if (resolved?.kind) finalKind = resolved.kind;
  }
  const startLine = offsetToLine(lineIndex, start);
  const endOffset = end > start ? end - 1 : start;
  const endLine = offsetToLine(lineIndex, endOffset);
  const signature = extractSignature(text, start, end, node, config.signatureBoundaryOptions);
  const docstring = declaration?.docstring ?? extractDocComment(
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
      definitionStartLine: offsetToLine(lineIndex, node.startIndex),
      ...callableGrammarMetadata(node,text),
      ...(config.resolveMetadata?.(node,text) || {}),
      ...(declaration?.metadata || {}),
      ...(['function_declarator', 'operator_cast', 'function_signature_item'].includes(node.type) ? { bodyless: true } : {}),
      signature,
      docstring
    }
  };
}

/**
 * Build chunks with tree-sitter parsing in the main thread.
 *
 * Strict-mode behavior differs from default fallback behavior: when parsing is
 * available but chunk extraction cannot proceed safely, strict mode returns a
 * deterministic whole-file chunk envelope or throws `ERR_TREE_SITTER_STRICT`
 * for true fallback-required paths.
 *
 * @param {{text:string,languageId?:string|null,ext?:string|null,options?:object}} input
 * @returns {Array<object>|null}
 */
export function buildTreeSitterChunks({ text, languageId, ext, options, captureNativeClassificationLeaves = true }) {
  const runScope = currentRunResourceScope(); runScope?.assertAccepting();
  throwIfAborted(options?.abortSignal);
  const resolvedId = resolveTreeSitterLanguageForExt(languageId, ext);
  if (!resolvedId) return null;
  if (!isTreeSitterEnabled(options, resolvedId)) return null;
  const strict = options?.treeSitter?.strict === true;
  let parserRecovered = null, leafOwnerRoot = null, leafWorkLimit = 0;
  const withLeafProduct = chunks => {
    if (!captureNativeClassificationLeaves) return chunks;
    try {
      if (!leafOwnerRoot || leafOwnerRoot.hasError !== false || !Array.isArray(chunks)
        || !chunks.some(chunk => chunk.start === 0 && chunk.end === text.length)
        || text.length > NATIVE_LEAF_PRODUCT_LIMITS.inputBytes || Buffer.byteLength(text) > NATIVE_LEAF_PRODUCT_LIMITS.inputBytes) return chunks;
      return attachNativeLeafProduct({ chunks, text, root: leafOwnerRoot,
        languageId: resolvedId, parserIdentity: getNativeTreeSitterIdentity(resolvedId), maxWork: leafWorkLimit,
        signal: options?.abortSignal });
    } catch (error) {
      if (getContainedFileSession(error) || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw error;
      observeStorageResource(error, { phase: 'native-projection-leaves' }).requireSettled();
      return chunks;
    }
  };
  const failStrict = (reason, message, extra = {}) => {
    if (!strict) return null;
    const err = new Error(message);
    err.code = 'ERR_TREE_SITTER_STRICT';
    err.reason = reason;
    err.languageId = resolvedId;
    Object.assign(err, extra);
    throw err;
  };
  const buildWholeFileChunk = reason => {
    const chunks = withParserCoverage([{
      start: 0,
      end: text.length,
      name: 'file',
      kind: 'File',
      meta: { treeSitter: true, wholeFile: true, ...(reason ? {
        syntaxCalls: Object.freeze([]), syntaxCallCoverage: 'partial-projection-budget:' + reason,
        syntaxCallOmissions: Object.freeze({ anonymousScopeCalls: 0, declarationHeaderCalls: 0 })
      } : {}) }
    }], resolvedId, parserRecovered);
    // An exhausted canonical projection cannot start an independent advisory
    // native leaf walk with a fresh budget. Its absence is not complete facts.
    return reason ? chunks : withLeafProduct(chunks);
  };
  if (shouldGuardNativeParser(resolvedId, options)) {
    bumpMetric('fallbacks', 1);
    const guardKey = `${resolvedId}:native-crash-guard`;
    if (options?.log && !loggedPlatformGuards.has(guardKey)) {
      options.log(
        `[tree-sitter] Native parser guarded for ${resolvedId} on ${process.platform}; ` +
        'skipping in-process parse due known native crash path.'
      );
      loggedPlatformGuards.add(guardKey);
    }
    if (strict) {
      // In strict mode, avoid process-terminating parser paths but still return
      // a deterministic tree-sitter-backed chunk envelope.
      return buildWholeFileChunk();
    }
    return null;
  }
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
  let lineCount = null;
  const getLineCount = () => {
    if (!shouldRecordMetrics && !shouldTrackDensity) return 0;
    if (lineCount === null) lineCount = countLines(text);
    return lineCount;
  };
  const metricsStart = shouldRecordMetrics ? Date.now() : 0;
  const recordMetrics = () => {
    if (!shouldRecordMetrics) return;
    const durationMs = Date.now() - metricsStart;
    metricsCollector.add('treeSitter', resolvedId, getLineCount(), durationMs);
  };
  const cacheKey = resolveChunkCacheKey(options, resolvedId);
  const cacheRef = cacheKey ? ensureChunkCache(options) : null;
  const persistentCacheRoot = cacheKey ? resolvePersistentChunkCacheRoot(options) : null;
  if (cacheKey && cacheRef) {
    const cached = loadCachedChunks({
      cache: cacheRef.cache,
      key: cacheKey,
      cacheRoot: persistentCacheRoot,
      sourceLength: text.length,
      bumpMetric
    });
    if (cached) {
      recordMetrics();
      return withParserCoverage(cached, resolvedId);
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
  const traversalBudget = resolveTraversalBudget(options, resolvedId, { bumpMetric });
  leafWorkLimit = traversalBudget.maxAstNodes;
  const work = createNativeProjectionWork(traversalBudget, { signal: options?.abortSignal,
    assertAccepting: () => runScope?.assertAccepting() });
  const projection = { work, names: createNativeProjectionNames({ text, config, work }) };
  const projectionFallback = error => {
    recordMetrics(); bumpMetric('fallbacks', 1); bumpMetric('projectionBudgetFailures', 1);
    if (options?.log) options.log(`[tree-sitter] Native projection exhausted ${error.reason} for ${resolvedId}; complete call evidence unavailable.`);
    return strict ? buildWholeFileChunk(error.reason) : null;
  };
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
      leafOwnerRoot = work.view(rootNode);
      if (resolvedId === 'groovy') parserRecovered = rootNode.hasError === true;
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
      queryResult = gatherChunksWithQuery(rootNode, text, config, traversalBudget, resolvedId, options, projection, parser);
    } catch (error) {
      if (isNativeProjectionBudgetFailure(error)) return projectionFallback(error);
      if (isAbortError(error) || getContainedFileSession(error)) throw error;
      observeStorageResource(error, { phase: 'native-projection-query-fallback' }).requireSettled();
      queryResult = null;
    }

    if (queryResult?.usedQuery) {
      if (Array.isArray(queryResult.chunks) && queryResult.chunks.length) {
        try { attachSyntaxCallFacts(work.view(rootNode),text,queryResult.chunks,{maxNodes:traversalBudget.maxAstNodes,maxStack:traversalBudget.maxAstStack,languageId:resolvedId}); }
        catch (error) { if (isNativeProjectionBudgetFailure(error)) return projectionFallback(error); throw error; }
        queryResult.chunks = withLeafProduct(withParserCoverage(queryResult.chunks, resolvedId, parserRecovered));
        if (cacheKey && cacheRef) {
          storeCachedChunks({
            cache: cacheRef.cache,
            key: cacheKey,
            chunks: queryResult.chunks,
            maxEntries: cacheRef.maxEntries,
            cacheRoot: persistentCacheRoot,
            sourceLength: text.length,
            bumpMetric
          });
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
      traversalResult = gatherChunkNodes(rootNode, text, config, traversalBudget, projection);
      if (shouldTrackDensity && traversalResult?.visited) {
        recordNodeDensity(resolvedId, traversalResult.visited, getLineCount());
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
    } catch (error) {
      if (isNativeProjectionBudgetFailure(error)) return projectionFallback(error);
      if (isAbortError(error) || getContainedFileSession(error)) throw error;
      observeStorageResource(error, { phase: 'native-projection-traversal' }).requireSettled();
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

    try { attachSyntaxCallFacts(work.view(rootNode),text,traversalResult.chunks,{maxNodes:traversalBudget.maxAstNodes,maxStack:traversalBudget.maxAstStack,languageId:resolvedId}); }
    catch (error) { if (isNativeProjectionBudgetFailure(error)) return projectionFallback(error); throw error; }
    traversalResult.chunks = withLeafProduct(withParserCoverage(traversalResult.chunks, resolvedId, parserRecovered));

    if (cacheKey && cacheRef) {
      storeCachedChunks({
        cache: cacheRef.cache,
        key: cacheKey,
        chunks: traversalResult.chunks,
        maxEntries: cacheRef.maxEntries,
        cacheRoot: persistentCacheRoot,
        sourceLength: text.length,
        bumpMetric
      });
    }
    recordMetrics();
    return traversalResult.chunks;
  } finally {
    const observation = work.snapshot();
    for (const [key, value] of Object.entries(observation)) if (typeof value === 'number' && key !== 'frontier') {
      bumpMetric('projection' + key[0].toUpperCase() + key.slice(1), value);
    }
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

/**
 * Build tree-sitter chunks using worker pool when configured.
 *
 * Worker results are treated as advisory: null/empty/error outcomes fall back
 * to synchronous parsing to preserve deterministic chunk coverage.
 *
 * @param {{text:string,languageId?:string|null,ext?:string|null,options?:object}} input
 * @returns {Promise<Array<object>|null>}
 */
export async function buildTreeSitterChunksAsync({ text, languageId, ext, options }) {
  currentRunResourceScope()?.assertAccepting();
  const signal = options?.abortSignal || options?.signal;
  throwIfAborted(signal);
  // If tree-sitter is disabled (or no config provided), keep the synchronous behavior.
  if (!options?.treeSitter || options.treeSitter.enabled === false) {
    return buildTreeSitterChunks({ text, languageId, ext, options });
  }

  const resolvedId = resolveTreeSitterLanguageForExt(languageId, ext);
  if (!resolvedId) return null;

  // Avoid spinning up / dispatching to workers when we already know we will skip tree-sitter.
  if (!isTreeSitterEnabled(options, resolvedId)) return null;
  if (treeSitterState.disabledLanguages?.has(resolvedId)) return null;
  if (exceedsTreeSitterLimits(text, options, resolvedId)) return null;
  if (!LANG_CONFIG[resolvedId]) return null;

  const cacheKey = resolveChunkCacheKey(options, resolvedId);
  const cacheRef = cacheKey ? ensureChunkCache(options) : null;
  const persistentCacheRoot = cacheKey ? resolvePersistentChunkCacheRoot(options) : null;
  if (cacheKey && cacheRef) {
    const cached = loadCachedChunks({
      cache: cacheRef.cache,
      key: cacheKey,
      cacheRoot: persistentCacheRoot,
      sourceLength: text.length,
      bumpMetric
    });
    if (cached) {
      throwIfAborted(signal);
      return withParserCoverage(cached, resolvedId);
    }
  }

  const pool = await getTreeSitterWorkerPool(options?.treeSitter?.worker, options);
  throwIfAborted(signal);
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
    const maxQueue = Number(pool.maxQueue ?? treeSitterState.treeSitterWorkerMaxQueue);
    const queueSize = Number(pool?.queueSize);
    throwIfAborted(signal);
    if (Number.isFinite(maxQueue) && maxQueue > 0
      && Number.isFinite(queueSize) && queueSize >= maxQueue) {
      bumpMetric('workerFallbacks', 1);
      return buildTreeSitterChunks({ text, languageId, ext, options: fallbackOptions });
    }
    const runOptions = { name: 'parseTreeSitter' };
    if (signal) {
      runOptions.signal = signal;
    }
    const result = await pool.run(payload, runOptions);
    throwIfAborted(signal);
    if (Array.isArray(result) && result.length) {
      const chunks = withParserCoverage(result, resolvedId);
      if (cacheKey && cacheRef) {
        storeCachedChunks({
          cache: cacheRef.cache,
          key: cacheKey,
          chunks,
          maxEntries: cacheRef.maxEntries,
          cacheRoot: persistentCacheRoot,
          sourceLength: text.length,
          bumpMetric
        });
      }
      return chunks;
    }

    // Null/empty results from a worker are treated as a failure signal; retry in-thread for determinism.
    bumpMetric('workerFallbacks', 1);
    return buildTreeSitterChunks({ text, languageId, ext, options: fallbackOptions });
  } catch (err) {
    if (isAbortError(err)) throw err;
    try { throwIfAborted(signal); }
    catch (abort) { throw addStorageFailureContext(abort, {}, err, { secondaryPresent: true }); }
    observeStorageResource(err, { phase: 'tree-sitter-worker-fallback' }).requireSettled();
    if (getContainedFileSession(err)) throw err;
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

import { collectCssImportEntries, prepareCssSource } from './css/source.js';
import { attachImportExtraction, getImportExtraction, projectImportExtraction } from '../shared/import-extraction.js';
export { collectCssImportEntries, prepareCssSource } from './css/source.js';
import { buildLineIndex, countLines, createLineAccessor, offsetToLine } from '../shared/lines.js';
import { extractDocComment, sliceSignature } from './shared.js';
import { getNativeTreeSitterParser } from './tree-sitter/native-runtime.js';
import { getNamedChild, getNamedChildCount } from './tree-sitter/ast.js';
import { isTreeSitterEnabled } from './tree-sitter/options.js';

export const CSS_RESERVED_WORDS = new Set([
  'all',
  'auto',
  'block',
  'bold',
  'border-box',
  'bottom',
  'center',
  'charset',
  'collapse',
  'color-profile',
  'container',
  'content-box',
  'counter-style',
  'currentcolor',
  'dashed',
  'default',
  'document',
  'double',
  'fixed',
  'flex',
  'font-face',
  'font-feature-values',
  'font-palette-values',
  'grid',
  'hidden',
  'important',
  'import',
  'inherit',
  'initial',
  'inline',
  'inline-block',
  'inline-flex',
  'inline-grid',
  'italic',
  'keyframes',
  'layer',
  'left',
  'media',
  'namespace',
  'none',
  'normal',
  'nowrap',
  'oblique',
  'page',
  'property',
  'relative',
  'revert',
  'revert-layer',
  'right',
  'round',
  'scope',
  'scroll',
  'solid',
  'starting-style',
  'static',
  'sticky',
  'supports',
  'top',
  'transparent',
  'unset',
  'view-transition',
  'viewport',
  'visible',
  'wrap'
]);

const RULE_NODES = new Set([
  'rule_set',
  'keyframes_statement',
  'media_statement',
  'supports_statement',
  'scope_statement',
  'font_face_statement',
  'at_rule'
]);

const loggedParseTimeouts = new Set();
const loggedSizeSkips = new Set();
const loggedTraversalBudget = new Set();
const loggedUnavailable = new Set();

// Guardrails: CSS can contain extremely large selector lists or nested at-rules.
// Keep traversal and chunk extraction bounded to avoid pathological memory / CPU usage.
const DEFAULT_MAX_AST_NODES = 250_000;
const DEFAULT_MAX_AST_STACK = 250_000;
const DEFAULT_MAX_CHUNK_NODES = 5_000;
const chunkPreparations = new WeakMap();
const chunkPolicy = options => {
  const config = options?.treeSitter || {}, css = config.byLanguage?.css || {};
  return JSON.stringify({ enabled: !options?.treeSitter || isTreeSitterEnabled(options, 'css'),
    traversal: resolveTraversalBudget(options), timeout: resolveParseTimeoutMs(options),
    maxBytes: css.maxBytes ?? config.maxBytes ?? null, maxLines: css.maxLines ?? config.maxLines ?? null });
};

export const prepareCssChunkContext = (text, options = {}) => {
  const cssSourceFacts = prepareCssSource(text, options);
  const cssChunks = ['cancelled', 'unsupported'].includes(cssSourceFacts.coverage.state)
    ? null : buildCssChunks(text, { ...options, cssSourceFacts });
  const cssChunkPreparation = Object.freeze({});
  chunkPreparations.set(cssChunkPreparation, { text, cssChunks, cssSourceFacts, policy: chunkPolicy(options) });
  return { cssSourceFacts, cssChunks, cssChunkPreparation };
};

export const resolveCssPreparedChunks = (text, context = {}, options = {}) => {
  const prepared = chunkPreparations.get(context?.cssChunkPreparation);
  if (prepared?.text === text && prepared.cssChunks === context.cssChunks && prepared.cssSourceFacts === context.cssSourceFacts
    && prepared.policy === chunkPolicy(options)) return prepared.cssChunks;
  return buildCssChunks(text, { ...options, cssSourceFacts: context?.cssSourceFacts });
};

function resolveTraversalBudget(options) {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.css || {};
  const maxAstNodes = perLanguage.maxAstNodes ?? config.maxAstNodes ?? DEFAULT_MAX_AST_NODES;
  const maxAstStack = perLanguage.maxAstStack ?? config.maxAstStack ?? DEFAULT_MAX_AST_STACK;
  const maxChunkNodes = perLanguage.maxChunkNodes ?? config.maxChunkNodes ?? DEFAULT_MAX_CHUNK_NODES;
  return {
    maxAstNodes: Number.isFinite(maxAstNodes) && maxAstNodes > 0 ? Math.floor(maxAstNodes) : DEFAULT_MAX_AST_NODES,
    maxAstStack: Number.isFinite(maxAstStack) && maxAstStack > 0 ? Math.floor(maxAstStack) : DEFAULT_MAX_AST_STACK,
    maxChunkNodes: Number.isFinite(maxChunkNodes) && maxChunkNodes > 0 ? Math.floor(maxChunkNodes) : DEFAULT_MAX_CHUNK_NODES
  };
}

function exceedsTreeSitterLimits(text, options) {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.css || {};
  const maxBytes = perLanguage.maxBytes ?? config.maxBytes;
  const maxLines = perLanguage.maxLines ?? config.maxLines;

  if (typeof maxBytes === 'number' && maxBytes > 0) {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) {
      const key = 'css:bytes';
      if (!loggedSizeSkips.has(key) && options?.log) {
        options.log(`Tree-sitter disabled for css; file exceeds maxBytes (${bytes} > ${maxBytes}).`);
        loggedSizeSkips.add(key);
      }
      return true;
    }
  }

  if (typeof maxLines === 'number' && maxLines > 0) {
    const lines = countLines(text);
    if (lines > maxLines) {
      const key = 'css:lines';
      if (!loggedSizeSkips.has(key) && options?.log) {
        options.log(`Tree-sitter disabled for css; file exceeds maxLines (${lines} > ${maxLines}).`);
        loggedSizeSkips.add(key);
      }
      return true;
    }
  }

  return false;
}

function resolveParseTimeoutMs(options) {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.css || {};
  const raw = perLanguage.maxParseMs ?? config.maxParseMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function extractRuleName(text, node) {
  const selectors = node.childForFieldName?.('selectors')
    || Array.from({length:getNamedChildCount(node)},(_,i)=>getNamedChild(node,i)).find(child=>child.type === 'selectors');
  const block = Array.from({length:getNamedChildCount(node)},(_,i)=>getNamedChild(node,i)).find(child=>child.type === 'block');
  const end = selectors?.endIndex ?? block?.startIndex ?? node.endIndex;
  // The grammar already resolved punctuation inside strings and selector lists.
  // Keep source spelling as identity, including quoted whitespace; signature is the preview.
  return text.slice(selectors?.startIndex ?? node.startIndex,end).replace(/;\s*$/,'').trim();
}

function gatherRuleNodes(root, budget) {
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

    if (RULE_NODES.has(node.type)) {
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

export function collectCssImports(text, options = {}) {
  const entries = collectCssImportEntries(text, options);
  const values = entries.map(entry => entry.specifier);
  attachImportExtraction(values, projectImportExtraction(getImportExtraction(entries), entries, values, { owner: 'css-string-array' }));
  return Object.defineProperty(values, 'coverage', { value: entries.coverage });
}

export function buildCssChunks(text, options = {}) {
  if (options.abortSignal?.aborted || options.signal?.aborted) return null;
  // If the caller provides tree-sitter options, respect enable/disable toggles.
  if (options?.treeSitter && !isTreeSitterEnabled(options, 'css')) {
    return buildCssHeuristicChunks(text, options);
  }
  if (exceedsTreeSitterLimits(text, options)) {
    return buildCssHeuristicChunks(text, options);
  }

  const parser = getNativeTreeSitterParser('css', options);
  if (!parser) {
    if (options?.log && !loggedUnavailable.has('css')) {
      options.log('Tree-sitter unavailable for css; falling back to heuristic chunking.');
      loggedUnavailable.add('css');
    }
    return buildCssHeuristicChunks(text, options);
  }

  const traversalBudget = resolveTraversalBudget(options);
  let tree = null;

  try {
    try {
      const parseTimeoutMs = resolveParseTimeoutMs(options);
      if (typeof parser.setTimeoutMicros === 'function') {
        parser.setTimeoutMicros(parseTimeoutMs ? parseTimeoutMs * 1000 : 0);
      }
      tree = parser.parse(text);
    } catch (err) {
      const message = err?.message || String(err);
      if (/timeout/i.test(message)) {
        if (options?.log && !loggedParseTimeouts.has('css')) {
          options.log('Tree-sitter parse timed out for css; falling back to heuristic chunking.');
          loggedParseTimeouts.add('css');
        }
      }
      return buildCssHeuristicChunks(text, options);
    }

    const rootNode = tree?.rootNode || null;
    if (!rootNode) return buildCssHeuristicChunks(text, options);

    const result = gatherRuleNodes(rootNode, traversalBudget);
    if (!result?.nodes) {
      const key = `css:${result?.reason || 'budget'}`;
      if (options?.log && !loggedTraversalBudget.has(key)) {
        options.log(
          `Tree-sitter traversal aborted for css (${result?.reason}); `
            + `visited=${result?.visited ?? 'n/a'} matched=${result?.matched ?? 'n/a'}. `
            + 'Falling back to heuristic chunking.'
        );
        loggedTraversalBudget.add(key);
      }
      return buildCssHeuristicChunks(text, options);
    }

    const nodes = result.nodes;
    if (!nodes.length) return buildCssHeuristicChunks(text, options);

    const lineIndex = buildLineIndex(text);
    const lineAccessor = createLineAccessor(text, lineIndex);
    const chunks = [];

    for (const node of nodes) {
      const name = extractRuleName(text, node);
      if (!name) continue;

      const start = node.startIndex;
      const end = node.endIndex;
      const startLine = offsetToLine(lineIndex, start);
      const endLine = offsetToLine(lineIndex, Math.max(start, end - 1));
      const signature = sliceSignature(text, start, Math.min(end, start + 240));
      const docstring = extractDocComment(lineAccessor, startLine - 1, {
        blockStarts: ['/**', '/*']
      });

      chunks.push({
        start,
        end,
        name,
        kind: 'StyleRule',
        meta: {
          startLine,
          endLine,
          signature,
          docstring
        }
      });
    }

    if (!chunks.length) return buildCssHeuristicChunks(text, options);
    chunks.sort((a, b) => a.start - b.start);
    return chunks;
  } finally {
    // Tree objects can retain parser-side allocations and should be explicitly released.
    try {
      if (tree && typeof tree.delete === 'function') tree.delete();
    } catch {
      // ignore disposal failures
    }

    // Reset parser state to avoid unbounded growth of internal allocations.
    try {
      if (parser && typeof parser.reset === 'function') parser.reset();
    } catch {
      // ignore reset failures
    }
  }
}

function buildCssHeuristicChunks(text, options = {}) {
  const chunks = [];
  const lineIndex = buildLineIndex(text);
  const lineAccessor = createLineAccessor(text, lineIndex);

  const facts = prepareCssSource(text, options);
  for (const block of facts.blocks) {
    const start = block.start, endIdx = block.end;
    const selector = text.slice(start, block.brace).trim();
    if (!selector) continue;
    const startLine = offsetToLine(lineIndex, start);
    const endLine = offsetToLine(lineIndex, Math.max(start, endIdx - 1));
    const signature = sliceSignature(text, start, Math.min(endIdx, start + 240));
    const docstring = extractDocComment(lineAccessor, startLine - 1, {
      linePrefixes: ['/*', '/**'],
      blockStarts: ['/*', '/**'],
      blockEnd: '*/'
    });

    chunks.push({
      start,
      end: endIdx,
      name: selector,
      kind: selector.startsWith('@') ? 'AtRule' : 'StyleRule',
      meta: {
        signature,
        docstring,
        startLine,
        endLine
      }
    });

  }

  return chunks.length ? chunks : null;
}

export function buildCssRelations(text, chunks = null, options = {}) {
  const facts = prepareCssSource(text, options);
  return {
    imports: [...new Set(facts.imports.map(occurrence => occurrence.specifier))],
    cssImportOccurrences: facts.imports,
    cssImportCoverage: facts.coverage,
    exports: [],
    calls: [],
    usages: [],
    importLinks: [],
    functionMeta: {},
    classMeta: {}
  };
}

export function extractCssDocMeta(chunk) {
  const meta = chunk?.meta || {};
  return {
    signature: meta.signature || null,
    docstring: meta.docstring || null
  };
}

export function computeCssFlow() {
  return null;
}

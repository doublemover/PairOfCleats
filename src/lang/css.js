import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { extractDocComment, sliceSignature } from './shared.js';
import { getTreeSitterParser } from './tree-sitter.js';
import { getNamedChild, getNamedChildCount } from './tree-sitter/ast.js';

const RULE_NODES = new Set([
  'rule_set',
  'keyframes_statement',
  'media_statement',
  'supports_statement',
  'font_face_statement',
  'at_rule'
]);

function extractRuleName(text, node) {
  const limit = Math.min(node.endIndex, node.startIndex + 240);
  const slice = text.slice(node.startIndex, limit);
  const newline = slice.indexOf('\n');
  const brace = slice.indexOf('{');
  const semi = slice.indexOf(';');
  const candidates = [newline, brace, semi].filter((idx) => idx >= 0);
  const cutoff = candidates.length ? Math.min(...candidates) : slice.length;
  return slice.slice(0, cutoff).replace(/\s+/g, ' ').trim();
}

function gatherRuleNodes(root) {
  const nodes = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    const missing = typeof node.isMissing === 'function' ? node.isMissing() : node.isMissing;
    if (missing) continue;
    if (RULE_NODES.has(node.type)) nodes.push(node);
    const count = getNamedChildCount(node);
    for (let i = count - 1; i >= 0; i -= 1) {
      stack.push(getNamedChild(node, i));
    }
  }
  return nodes;
}

export function collectCssImports(text) {
  const imports = new Set();
  const regex = /@import\s+(?:url\()?['"]?([^'")\s;]+)['"]?\)?/gi;
  for (const match of text.matchAll(regex)) {
    if (match[1]) imports.add(match[1]);
  }
  return Array.from(imports);
}

export function buildCssChunks(text) {
  const parser = getTreeSitterParser('css');
  if (!parser) return buildCssHeuristicChunks(text);
  let tree = null;
  try {
    try {
      tree = parser.parse(text);
    } catch {
      return buildCssHeuristicChunks(text);
    }

    let rootNode = null;
    try {
      rootNode = tree?.rootNode;
    } catch {
      return buildCssHeuristicChunks(text);
    }
    if (!rootNode) return buildCssHeuristicChunks(text);

    const nodes = gatherRuleNodes(rootNode);
    if (!nodes.length) return buildCssHeuristicChunks(text);

    const lineIndex = buildLineIndex(text);
    const lines = text.split('\n');
    const chunks = [];
    for (const node of nodes) {
      const name = extractRuleName(text, node);
      if (!name) continue;
      const start = node.startIndex;
      const end = node.endIndex;
      const startLine = offsetToLine(lineIndex, start);
      const endLine = offsetToLine(lineIndex, Math.max(start, end - 1));
      const signature = sliceSignature(text, start, Math.min(end, start + 240));
      const docstring = extractDocComment(lines, startLine - 1, {
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
    if (!chunks.length) return null;
    chunks.sort((a, b) => a.start - b.start);
    return chunks;
  } finally {
    // Ensure we release WASM-backed tree memory.
    try {
      if (tree && typeof tree.delete === 'function') tree.delete();
    } catch {
      // ignore disposal failures
    }
  }
}

function buildCssHeuristicChunks(text) {
  const chunks = [];
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  let idx = 0;
  while (idx < text.length) {
    const brace = text.indexOf('{', idx);
    if (brace === -1) break;
    const selectorStart = Math.max(text.lastIndexOf('\n', brace), text.lastIndexOf('\r', brace)) + 1;
    const selector = text.slice(selectorStart, brace).trim();
    if (!selector) {
      idx = brace + 1;
      continue;
    }
    let depth = 0;
    let end = brace;
    for (; end < text.length; end += 1) {
      const ch = text[end];
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth <= 0) {
          end += 1;
          break;
        }
      }
    }
    const start = selectorStart;
    const endIdx = Math.min(text.length, end);
    const startLine = offsetToLine(lineIndex, start);
    const endLine = offsetToLine(lineIndex, Math.max(start, endIdx - 1));
    const signature = sliceSignature(text, start, Math.min(endIdx, start + 240));
    const docstring = extractDocComment(lines, startLine - 1, {
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
    idx = endIdx;
  }
  return chunks.length ? chunks : null;
}

export function buildCssRelations(text, allImports) {
  return { imports: collectCssImports(text), exports: [], calls: [], usages: [], importLinks: [], functionMeta: {}, classMeta: {} };
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

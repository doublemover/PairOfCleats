import { createRequire } from 'node:module';
import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { extractDocComment, sliceSignature } from './shared.js';

const require = createRequire(import.meta.url);
let TreeSitter = null;
let CssLanguage = null;
let loadError = null;

const RULE_NODES = new Set([
  'rule_set',
  'keyframes_statement',
  'media_statement',
  'supports_statement',
  'font_face_statement',
  'at_rule'
]);

function loadParser() {
  if (TreeSitter && CssLanguage) return { TreeSitter, CssLanguage };
  if (loadError) return null;
  try {
    TreeSitter = require('tree-sitter');
    const mod = require('tree-sitter-css');
    CssLanguage = mod?.language || mod?.default || mod || null;
    if (!CssLanguage) throw new Error('Missing tree-sitter-css language');
    return { TreeSitter, CssLanguage };
  } catch (err) {
    loadError = err;
    return null;
  }
}

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
    if (!node || node.isMissing) continue;
    if (RULE_NODES.has(node.type)) nodes.push(node);
    if (node.namedChildren && node.namedChildren.length) {
      for (let i = node.namedChildren.length - 1; i >= 0; i -= 1) {
        stack.push(node.namedChildren[i]);
      }
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
  const loader = loadParser();
  if (!loader) return null;
  const parser = new loader.TreeSitter();
  try {
    parser.setLanguage(loader.CssLanguage);
  } catch {
    return null;
  }
  let tree;
  try {
    tree = parser.parse(text);
  } catch {
    return null;
  }
  const rootNode = tree?.rootNode;
  if (!rootNode) return null;
  const nodes = gatherRuleNodes(rootNode);
  if (!nodes.length) return null;
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

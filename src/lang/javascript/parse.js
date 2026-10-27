import { createRequire } from 'node:module';
import * as acorn from 'acorn';
import * as esprima from 'esprima';
import { parseBabelAst } from '../babel-parser.js';

const require = createRequire(import.meta.url);
const parserVersions = { babel: require('@babel/parser/package.json').version,
  acorn: require('acorn/package.json').version, esprima: require('esprima/package.json').version };
const syntaxOwners = new WeakMap();
const syntaxSources = new WeakMap();
const syntaxComments = new WeakMap();
export const JAVASCRIPT_COMMENT_LIMIT = 20000;
export const getJavaScriptSyntaxIdentity = (ast) => syntaxOwners.get(ast) || null;
export const ownsJavaScriptSyntaxText = (ast, text) => syntaxSources.has(ast) && syntaxSources.get(ast) === text;
export const getJavaScriptCommentRanges = (ast, text) => ownsJavaScriptSyntaxText(ast, text) ? syntaxComments.get(ast) || null : null;

const JS_PARSERS = new Set(['auto', 'babel', 'acorn', 'esprima']);

function resolveJsParser(options = {}) {
  const raw = options.parser || options.javascript?.parser || options.javascriptParser;
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return JS_PARSERS.has(normalized) ? normalized : 'babel';
}

function resolveFlowMode(options = {}) {
  const raw = options.flowMode ?? options.flow ?? options.javascript?.flow ?? options.javascriptFlow;
  if (raw === true) return 'on';
  if (raw === false) return 'off';
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return ['auto', 'on', 'off'].includes(normalized) ? normalized : 'auto';
}

function parseWithAcorn(text) {
  const comments = [];
  const ast = acorn.parse(text, {
    ecmaVersion: 'latest',
    locations: true,
    ranges: true,
    sourceType: 'module',
    onComment: comments
  });
  Object.defineProperty(ast, 'comments', { value: comments });
  return ast;
}

function parseWithEsprima(text) {
  return esprima.parseModule(text, {
    jsx: true,
    tolerant: true,
    comment: true,
    loc: true,
    range: true
  });
}

export function parseJavaScriptAst(text, options = {}) {
  const parser = resolveJsParser(options);
  const flowMode = resolveFlowMode(options);
  const ext = typeof options.ext === 'string' ? options.ext : '';
  const tryParse = (kind) => {
    try {
      if (kind === 'babel') return parseBabelAst(text, { ext, flowMode, mode: 'javascript' });
      if (kind === 'acorn') return parseWithAcorn(text);
      if (kind === 'esprima') return parseWithEsprima(text);
      return null;
    } catch {
      return null;
    }
  };


  const order = (() => {
    if (parser === 'auto') return ['babel', 'acorn', 'esprima'];
    if (parser === 'babel') return ['babel', 'acorn', 'esprima'];
    if (parser === 'acorn') return ['acorn', 'babel', 'esprima'];
    if (parser === 'esprima') return ['esprima', 'babel', 'acorn'];
    return ['babel', 'acorn', 'esprima'];
  })();

  for (const kind of order) {
    const ast = tryParse(kind);
    if (ast) {
      syntaxOwners.set(ast, { family: kind, version: parserVersions[kind], options: { ext, flowMode } });
      syntaxSources.set(ast, text);
      const comments = Array.isArray(ast.comments) ? ast.comments : [];
      let complete = comments.length <= JAVASCRIPT_COMMENT_LIMIT;
      const ranges = [];
      if (complete) for (const comment of comments) {
        const start = comment.start ?? comment.range?.[0], end = comment.end ?? comment.range?.[1];
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length) {
          complete = false; break;
        }
        ranges.push(Object.freeze({ start, end }));
      }
      syntaxComments.set(ast, Object.freeze({ complete,
        ranges: Object.freeze(complete ? ranges.sort((a, b) => a.end - b.end) : []) }));
      return ast;
    }
  }
  return null;
}

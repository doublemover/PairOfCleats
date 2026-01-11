import * as acorn from 'acorn';
import * as esprima from 'esprima';
import { parseBabelAst } from '../babel-parser.js';

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
  return acorn.parse(text, {
    ecmaVersion: 'latest',
    locations: true,
    ranges: true,
    sourceType: 'module'
  });
}

function parseWithEsprima(text) {
  return esprima.parseModule(text, {
    jsx: true,
    tolerant: true,
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
    if (ast) return ast;
  }
  return null;
}

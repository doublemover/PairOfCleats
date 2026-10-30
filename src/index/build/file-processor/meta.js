import util from 'node:util';
import { isBuiltin } from 'node:module';
import { isPythonStandardLibraryImport } from '../../../shared/python-stdlib.js';
import { isGo, isJsLike } from '../../constants.js';
import { mergeQualifiedFlowMeta } from './flow-meta.js';

export const normalizeDocMeta = (docmeta) => (
  docmeta && typeof docmeta === 'object' && !Array.isArray(docmeta)
    ? { ...docmeta }
    : {}
);

export const mergeFlowMeta = mergeQualifiedFlowMeta;

export const buildExternalDocs = (ext, imports) => {
  const externalDocs = new Set();
  if (!imports || !imports.length) return [];
  const isPython = ext === '.py' || ext === '.pyi';
  const isNode = isJsLike(ext);
  const isGoLang = isGo(ext);
  for (const mod of imports) {
    if (typeof mod !== 'string' || !mod) continue;
    if (mod.startsWith('.')) continue;
    if (isPython) {
      if (isPythonStandardLibraryImport(mod)) continue;
      const base = mod.split('.')[0];
      if (base) externalDocs.add(`https://pypi.org/project/${base}`);
    } else if (isNode) {
      if (mod.startsWith('node:') || isBuiltin(mod)) continue;
      const encoded = mod
        .split('/')
        .map((segment) => encodeURIComponent(segment).replace(/%40/g, '@'))
        .join('/');
      externalDocs.add(`https://www.npmjs.com/package/${encoded}`);
    } else if (isGoLang) {
      externalDocs.add(`https://pkg.go.dev/${mod}`);
    }
  }
  return Array.from(externalDocs).sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
};

const normalizeEmptyMessage = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === '{}' || trimmed === '[object Object]') return null;
  if (/^Error:?\s*\{\}$/i.test(trimmed)) return null;
  if (/^Error:?\s*\[object Object\]$/i.test(trimmed)) return null;
  return value;
};

const describeObject = (value) => {
  if (!value || typeof value !== 'object') return '';
  const ctor = value.constructor && value.constructor.name
    ? value.constructor.name
    : 'Object';
  const keys = Object.keys(value);
  if (keys.length) {
    return `${ctor} keys: ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? '...' : ''}`;
  }
  const ownProps = Object.getOwnPropertyNames(value);
  const ownSymbols = Object.getOwnPropertySymbols(value);
  const propList = [...ownProps, ...ownSymbols.map((sym) => sym.toString())];
  if (propList.length) {
    return `${ctor} props: ${propList.slice(0, 6).join(', ')}${propList.length > 6 ? '...' : ''}`;
  }
  return `${ctor} (no enumerable keys)`;
};

export const formatError = (err) => {
  if (!err) return 'unknown error';
  if (typeof err === 'string') {
    const normalized = normalizeEmptyMessage(err);
    return normalized || 'unhelpful error string';
  }
  if (err instanceof Error) {
    const name = err.name || 'Error';
    const message = normalizeEmptyMessage(err.message) || '';
    return message ? `${name}: ${message}` : name;
  }
  if (typeof err?.message === 'string') {
    const normalized = normalizeEmptyMessage(err.message);
    if (normalized) return normalized;
  }
  if (Array.isArray(err?.errors) && err.errors.length) {
    const inner = err.errors
      .map((innerErr) => formatError(innerErr))
      .filter(Boolean)
      .join(' | ');
    if (inner) return `AggregateError: ${inner}`;
  }
  if (typeof err?.code === 'string') return `Error code: ${err.code}`;
  try {
    const json = JSON.stringify(err);
    const normalized = normalizeEmptyMessage(json);
    if (normalized && normalized !== '[]') return normalized;
  } catch {
    // Fall through to util.inspect.
  }
  try {
    const inspected = util.inspect(err, {
      depth: 3,
      breakLength: 120,
      showHidden: true,
      getters: true
    });
    const normalized = normalizeEmptyMessage(inspected);
    if (normalized) return normalized;
    const summary = describeObject(err);
    if (summary) return `unhelpful error object: ${summary}`;
  } catch {
    // ignore
  }
  const summary = describeObject(err);
  return summary || String(err);
};

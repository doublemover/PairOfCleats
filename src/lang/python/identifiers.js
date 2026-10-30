import { PYTHON_XID_START, PYTHON_XID_CONTINUE } from './identifier-tables.js';
// CPython's exact source identifier predicates, including its join-control policy.
export const PYTHON_IDENTIFIER_PROFILE = Object.freeze({ python: '3.15', unicode: '17.0',
  method: 'cpython-isidentifier-ranges', available: process.versions.unicode === '17.0' });
const contains = (ranges, value) => {
  let low = 0, high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1, [start, end] = ranges[middle];
    if (value < start) high = middle - 1;
    else if (value > end) low = middle + 1;
    else return true;
  }
  return false;
};
const identifier = raw => {
  let first = true;
  for (const char of raw) {
    if (!contains(first ? PYTHON_XID_START : PYTHON_XID_CONTINUE, char.codePointAt(0))) return false;
    first = false;
  }
  return !first;
};
const keywords = new Set(['False','None','True','and','as','assert','async','await','break','class','continue',
  'def','del','elif','else','except','finally','for','from','global','if','import','in','is','lambda','nonlocal',
  'not','or','pass','raise','return','try','while','with','yield']);
export const pythonIdentifier = raw => {
  if (!PYTHON_IDENTIFIER_PROFILE.available || typeof raw !== 'string' || !identifier(raw)) return null;
  const semantic = raw.normalize('NFKC');
  // Python reserves keyword source spelling before normalization.
  if (!identifier(semantic) || keywords.has(raw)) return null;
  return { raw, semantic };
};
export const pythonModuleName = (raw, { allowRelative = false } = {}) => {
  const prefix = allowRelative ? raw.match(/^\.+/u)?.[0] || '' : '';
  const body = raw.slice(prefix.length);
  if (!body) return prefix ? { raw, semantic: prefix } : null;
  const names = body.split('.').map(pythonIdentifier);
  return names.every(Boolean) ? { raw, semantic: prefix + names.map(name => name.semantic).join('.') } : null;
};

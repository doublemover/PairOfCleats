import path from 'node:path';

const normalizePathKey = (value) => String(value || '').trim().toLowerCase();

const dedupePathEntries = (entries, { caseInsensitive = process.platform === 'win32' } = {}) => {
  const seen = new Set();
  const output = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const value = String(entry || '').trim();
    if (!value) continue;
    const key = caseInsensitive ? value.toLowerCase() : value;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
};

const splitPathEntries = (value = '') => (
  String(value || '')
    .split(path.delimiter)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
);

export const resolvePathEnvKey = (env = process.env, { preferredKey = '' } = {}) => {
  const input = env && typeof env === 'object' ? env : {};
  const keys = Object.keys(input);
  const pathKeys = keys.filter((key) => normalizePathKey(key) === 'path');
  const preferred = String(preferredKey || '').trim();
  if (preferred && pathKeys.includes(preferred)) return preferred;
  if (process.platform === 'win32') {
    if (pathKeys.includes('Path')) return 'Path';
    if (pathKeys.includes('PATH')) return 'PATH';
  } else if (pathKeys.includes('PATH')) {
    return 'PATH';
  }
  if (pathKeys.length) return pathKeys[0];
  if (preferred) return preferred;
  return process.platform === 'win32' ? 'Path' : 'PATH';
};

export const resolveEnvPathEntries = (env = process.env) => {
  const input = env && typeof env === 'object' ? env : {};
  const pathKeys = Object.keys(input).filter((key) => normalizePathKey(key) === 'path');
  if (!pathKeys.length) return [];
  const entries = [];
  for (const key of pathKeys) {
    entries.push(...splitPathEntries(input[key]));
  }
  return dedupePathEntries(entries);
};

export const resolveEnvPath = (env = process.env) => (
  resolveEnvPathEntries(env).join(path.delimiter)
);

export const normalizeEnvPathKeys = (env = process.env, options = {}) => {
  if (!env || typeof env !== 'object') {
    return { key: resolvePathEnvKey({}, options), value: '' };
  }
  const key = resolvePathEnvKey(env, options);
  const value = resolveEnvPath(env);
  if (value) {
    env[key] = value;
  } else if (env[key] === undefined) {
    env[key] = '';
  }
  for (const candidate of Object.keys(env)) {
    if (candidate === key) continue;
    if (normalizePathKey(candidate) !== 'path') continue;
    delete env[candidate];
  }
  return { key, value: String(env[key] || '') };
};

export { dedupePathEntries, splitPathEntries };

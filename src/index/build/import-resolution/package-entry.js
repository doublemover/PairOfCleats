import fs from 'node:fs';
import path from 'node:path';
import { isAbsolutePathNative } from '../../../shared/files.js';
import { normalizeRelPath, sortStrings } from './path-utils.js';
import { resolveCandidate, resolveFromLookup } from './lookup.js';

const PACKAGE_ENTRY_CONDITION_ORDER = [
  'import',
  'require',
  'default',
  'node',
  'module',
  'browser'
];

const normalizePackageEntryPath = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#')) return null;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return null;
  if (isAbsolutePathNative(trimmed)) return null;
  if (trimmed.startsWith('/')) return null;
  if (trimmed === '.' || trimmed === './') return '';
  const normalized = normalizeRelPath(trimmed);
  if (normalized.startsWith('..')) return null;
  return normalized;
};

const selectPackageConditionalTarget = (value) => {
  if (typeof value === 'string') return normalizePackageEntryPath(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const picked = selectPackageConditionalTarget(entry);
      if (picked != null) return picked;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const condition of PACKAGE_ENTRY_CONDITION_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(value, condition)) continue;
    const picked = selectPackageConditionalTarget(value[condition]);
    if (picked != null) return picked;
  }
  const keys = Object.keys(value).filter((key) => !key.startsWith('.')).sort(sortStrings);
  for (const key of keys) {
    const picked = selectPackageConditionalTarget(value[key]);
    if (picked != null) return picked;
  }
  return null;
};

const selectPackageRootEntry = (packageJson) => {
  if (!packageJson || typeof packageJson !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(packageJson, 'exports')) {
    const exportsField = packageJson.exports;
    if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
      const picked = selectPackageConditionalTarget(exportsField);
      if (picked != null) return picked;
    } else if (exportsField && typeof exportsField === 'object') {
      if (Object.prototype.hasOwnProperty.call(exportsField, '.')) {
        const picked = selectPackageConditionalTarget(exportsField['.']);
        if (picked != null) return picked;
      } else {
        const hasSubpathKeys = Object.keys(exportsField).some((key) => key.startsWith('.'));
        if (!hasSubpathKeys) {
          const picked = selectPackageConditionalTarget(exportsField);
          if (picked != null) return picked;
        }
      }
    }
  }
  for (const field of ['main', 'module', 'source']) {
    const picked = normalizePackageEntryPath(packageJson[field]);
    if (picked != null) return picked;
  }
  return null;
};

export const createPackageDirectoryResolver = ({ lookup, rootAbs }) => {
  const cache = new Map();
  const packageEntryCache = new Map();
  const readPackageEntry = (cacheKey, packageJsonAbs) => {
    if (!cacheKey || !packageJsonAbs) return null;
    if (packageEntryCache.has(cacheKey)) return packageEntryCache.get(cacheKey);
    let packageEntry = null;
    try {
      const raw = fs.readFileSync(packageJsonAbs, 'utf8');
      const parsed = JSON.parse(raw);
      packageEntry = selectPackageRootEntry(parsed);
    } catch {}
    packageEntryCache.set(cacheKey, packageEntry);
    return packageEntry;
  };
  const resolveDevSourceEntry = (base) => {
    const candidates = ['src/index', 'src/main', 'lib/index', 'source/index'];
    for (const candidate of candidates) {
      const targetBase = base ? path.posix.join(base, candidate) : candidate;
      const resolved = resolveCandidate(targetBase, lookup);
      if (resolved) return resolved;
    }
    return null;
  };
  return (baseRelPath) => {
    const base = normalizeRelPath(baseRelPath);
    const cacheKey = base || '.';
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const packageJsonCandidate = base ? `${base}/package.json` : 'package.json';
    const packageJsonRel = resolveFromLookup(packageJsonCandidate, lookup);
    const packageJsonAbs = packageJsonRel
      ? path.resolve(rootAbs, packageJsonRel)
      : path.resolve(rootAbs, packageJsonCandidate);
    let hasPackageJson = !!packageJsonRel;
    if (!hasPackageJson) {
      try {
        hasPackageJson = fs.existsSync(packageJsonAbs);
      } catch {
        hasPackageJson = false;
      }
    }
    if (!hasPackageJson) {
      cache.set(cacheKey, null);
      return null;
    }
    let resolved = null;
    const packageEntry = readPackageEntry(packageJsonRel || packageJsonAbs, packageJsonAbs);
    if (packageEntry != null) {
      const targetBase = packageEntry
        ? normalizeRelPath(base ? path.posix.join(base, packageEntry) : packageEntry)
        : base;
      resolved = resolveCandidate(targetBase, lookup);
    }
    if (!resolved) {
      resolved = resolveDevSourceEntry(base);
    }
    cache.set(cacheKey, resolved);
    return resolved;
  };
};

export const parsePackageName = (spec) => {
  if (!spec) return null;
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  const [name] = spec.split('/');
  return name || null;
};

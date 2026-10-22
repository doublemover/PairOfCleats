import fs from 'node:fs';
import path from 'node:path';
import { isAbsolutePathNative, isRelativePathEscape } from '../../../shared/file-paths.js';
import { normalizeRelPath, sortStrings } from './path-utils.js';
import { resolveCandidate, resolveFromLookup } from './lookup.js';
import { sha1 } from '../../../shared/hash.js';

export const fingerprintPackageDependency = file => {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return 'unavailable';
    return sha1(fs.readFileSync(file));
  } catch (error) { return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? 'absent' : 'unavailable'; }
};

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
  if (isRelativePathEscape(normalized)) return null;
  return normalized;
};

const selectPackageConditionalTarget = (value, relativeOnly = false) => {
  if (typeof value === 'string') return relativeOnly && !value.startsWith('./')
    ? null : normalizePackageEntryPath(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const picked = selectPackageConditionalTarget(entry, relativeOnly);
      if (picked != null) return picked;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const condition of PACKAGE_ENTRY_CONDITION_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(value, condition)) continue;
    const picked = selectPackageConditionalTarget(value[condition], relativeOnly);
    if (picked != null) return picked;
  }
  const keys = Object.keys(value).filter((key) => !key.startsWith('.')).sort(sortStrings);
  for (const key of keys) {
    const picked = selectPackageConditionalTarget(value[key], relativeOnly);
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

export const createPackageDirectoryResolver = ({ lookup, rootAbs, onDependency = null }) => {
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
    const packageJsonCandidate = base ? `${base}/package.json` : 'package.json';
    const packageJsonRel = resolveFromLookup(packageJsonCandidate, lookup);
    const packageJsonAbs = packageJsonRel
      ? path.resolve(rootAbs, packageJsonRel)
      : path.resolve(rootAbs, packageJsonCandidate);
    onDependency?.(packageJsonAbs, fingerprintPackageDependency(packageJsonAbs));
    if (cache.has(cacheKey)) return cache.get(cacheKey);
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

/** Node package #imports preserve their scoped package identity and target order. */
export const createPackageImportsResolver = ({ lookup, rootAbs, onDependency = null }) => (specifier, importerRel) => {
  if (!specifier.startsWith('#')) return null;
  let directory = path.dirname(path.resolve(rootAbs, importerRel));
  for (;;) {
    const packagePath = path.join(directory, 'package.json');
    const signature = fingerprintPackageDependency(packagePath);
    onDependency?.(packagePath, signature);
    if (signature !== 'absent') {
      if (signature === 'unavailable') return null;
      let imports;
      try { imports = JSON.parse(fs.readFileSync(packagePath, 'utf8')).imports; } catch { return null; }
      if (!imports || typeof imports !== 'object') return null;
      let value = imports[specifier], capture = null;
      if (!Object.hasOwn(imports, specifier)) {
        let best = null;
        for (const pattern of Object.keys(imports)) {
          const star = pattern.indexOf('*');
          if (star < 0 || !specifier.startsWith(pattern.slice(0,star)) || !specifier.endsWith(pattern.slice(star+1))) continue;
          if (!best || star > best.star || (star === best.star && pattern.length > best.pattern.length)) best = {pattern,star};
        }
        if (!best) return null;
        capture = specifier.slice(best.star, specifier.length - (best.pattern.length-best.star-1));
        value = imports[best.pattern];
      }
      const target = selectPackageConditionalTarget(value, true);
      if (!target) return null;
      const resolvedTarget = capture == null ? target : target.replaceAll('*', capture);
      const absolute = path.resolve(directory, resolvedTarget);
      if (isRelativePathEscape(path.relative(directory, absolute))) return null;
      const relative = path.relative(rootAbs, absolute).split(path.sep).join('/');
      if (isRelativePathEscape(relative) || isAbsolutePathNative(relative)) return null;
      return resolveCandidate(relative, lookup);
    }
    if (directory === path.resolve(rootAbs)) return null;
    const parent = path.dirname(directory);
    if (parent === directory || isRelativePathEscape(path.relative(rootAbs,parent))) return null;
    directory = parent;
  }
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

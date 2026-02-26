import crypto from 'node:crypto';
import path from 'node:path';
import { toPosix } from '../../../shared/files.js';
import { sha1 } from '../../../shared/hash.js';
import { toArray } from '../../../shared/iterables.js';
import { resolveRelativeImportCandidate } from '../../shared/import-candidates.js';
import { DEFAULT_IMPORT_EXTS, IMPORT_LOOKUP_CACHE_SCHEMA_VERSION } from './constants.js';
import { createFsMemo } from './fs-meta.js';
import {
  normalizeRelPath,
  resolveWithinRoot,
  sortStrings,
  stripImportExtension
} from './path-utils.js';

const createPathTrie = () => ({ children: new Map() });

const addPathToTrie = (trie, relPath) => {
  if (!relPath) return;
  const parts = relPath.split('/').filter(Boolean);
  let node = trie;
  for (const part of parts) {
    if (!node.children.has(part)) {
      node.children.set(part, { children: new Map() });
    }
    node = node.children.get(part);
  }
};

const trieHasPrefix = (trie, relPath) => {
  if (!relPath) return false;
  const parts = relPath.split('/').filter(Boolean);
  let node = trie;
  for (const part of parts) {
    const next = node.children.get(part);
    if (!next) return false;
    node = next;
  }
  return true;
};

const serializePathTrie = (node) => {
  if (!node || !(node.children instanceof Map)) return {};
  const out = {};
  const keys = Array.from(node.children.keys()).sort(sortStrings);
  for (const key of keys) {
    out[key] = serializePathTrie(node.children.get(key));
  }
  return out;
};

const deserializePathTrie = (raw) => {
  const node = { children: new Map() };
  if (!raw || typeof raw !== 'object') return node;
  for (const key of Object.keys(raw).sort(sortStrings)) {
    node.children.set(key, deserializePathTrie(raw[key]));
  }
  return node;
};

const buildDirIndexFromFileSet = (fileSet) => {
  const dirIndex = new Map();
  for (const relPath of toArray(fileSet)) {
    const normalized = normalizeRelPath(relPath);
    if (!normalized) continue;
    const dir = path.posix.dirname(normalized);
    const key = dir === '.' ? '' : dir;
    if (!dirIndex.has(key)) dirIndex.set(key, []);
    dirIndex.get(key).push(normalized);
  }
  for (const entries of dirIndex.values()) {
    entries.sort(sortStrings);
  }
  return dirIndex;
};

export const computeFileSetFingerprint = (fileSet) => {
  if (!fileSet || typeof fileSet.size !== 'number' || fileSet.size === 0) return null;
  const list = Array.from(fileSet);
  list.sort(sortStrings);
  const hash = crypto.createHash('sha1');
  for (const rel of list) {
    hash.update(rel);
    hash.update('\n');
  }
  return hash.digest('hex');
};

export const buildLookupCompatibilityFingerprint = ({ rootAbs, fileSetFingerprint }) => {
  if (!rootAbs || !fileSetFingerprint) return null;
  return sha1(JSON.stringify({
    schemaVersion: IMPORT_LOOKUP_CACHE_SCHEMA_VERSION,
    rootHash: sha1(rootAbs),
    fileSetFingerprint
  }));
};

export const createLookupSnapshot = ({ lookup, fileSetFingerprint, compatibilityFingerprint }) => {
  if (!lookup || !fileSetFingerprint || !compatibilityFingerprint) return null;
  const fileSet = Array.from(lookup.fileSet || []);
  fileSet.sort(sortStrings);
  const fileLower = {};
  for (const [key, value] of Array.from(lookup.fileLower?.entries?.() || [])) {
    fileLower[key] = value;
  }
  return {
    compatibilityFingerprint,
    rootHash: sha1(lookup.rootAbs),
    fileSetFingerprint,
    hasTsconfig: lookup.hasTsconfig === true,
    fileSet,
    fileLower,
    pathTrie: serializePathTrie(lookup.pathTrie)
  };
};

export const createLookupFromSnapshot = ({ root, snapshot }) => {
  if (!root || !snapshot || typeof snapshot !== 'object') return null;
  const rootAbs = path.resolve(root);
  const files = Array.isArray(snapshot.fileSet) ? snapshot.fileSet : [];
  if (!files.length) return null;
  const fileSet = new Set(files.map((entry) => normalizeRelPath(entry)).filter(Boolean));
  const fileLower = new Map();
  for (const [lower, relPath] of Object.entries(snapshot.fileLower || {})) {
    if (typeof lower !== 'string' || typeof relPath !== 'string') continue;
    fileLower.set(lower, normalizeRelPath(relPath));
  }
  if (fileLower.size === 0) {
    for (const relPath of fileSet.values()) {
      const lower = relPath.toLowerCase();
      if (!fileLower.has(lower) || sortStrings(relPath, fileLower.get(lower)) < 0) {
        fileLower.set(lower, relPath);
      }
    }
  }
  const pathTrie = deserializePathTrie(snapshot.pathTrie);
  const dirIndex = buildDirIndexFromFileSet(fileSet);
  return {
    rootAbs,
    fileSet,
    fileLower,
    hasTsconfig: snapshot.hasTsconfig === true,
    pathTrie,
    dirIndex
  };
};

export const collectEntryFileSet = ({ entries, root }) => {
  const rootAbs = path.resolve(root);
  const fileSet = new Set();
  for (const entry of toArray(entries)) {
    const abs = typeof entry === 'string' ? entry : entry?.abs;
    if (!abs) continue;
    const rel = typeof entry === 'object' && entry.rel
      ? entry.rel
      : path.relative(rootAbs, abs);
    const relPosix = normalizeRelPath(toPosix(rel));
    if (!relPosix) continue;
    fileSet.add(relPosix);
  }
  return { rootAbs, fileSet };
};

export const createFileLookup = ({ entries, root, fsMemo = null }) => {
  const io = fsMemo || createFsMemo();
  const rootAbs = path.resolve(root);
  const fileSet = new Set();
  const fileLower = new Map();
  const pathTrie = createPathTrie();
  const dirIndex = new Map();
  let hasTsconfig = false;
  for (const entry of toArray(entries)) {
    const abs = typeof entry === 'string' ? entry : entry.abs;
    if (!abs) continue;
    const rel = typeof entry === 'object' && entry.rel
      ? entry.rel
      : path.relative(rootAbs, abs);
    const relPosix = normalizeRelPath(toPosix(rel));
    if (!relPosix) continue;
    fileSet.add(relPosix);
    const lower = relPosix.toLowerCase();
    if (lower.endsWith('tsconfig.json')) hasTsconfig = true;
    if (!fileLower.has(lower) || sortStrings(relPosix, fileLower.get(lower)) < 0) {
      fileLower.set(lower, relPosix);
    }
    const basePath = stripImportExtension(relPosix);
    if (basePath) addPathToTrie(pathTrie, basePath);
    addPathToTrie(pathTrie, relPosix);

    const dir = path.posix.dirname(relPosix);
    const key = dir === '.' ? '' : dir;
    if (!dirIndex.has(key)) dirIndex.set(key, []);
    dirIndex.get(key).push(relPosix);
  }
  for (const values of dirIndex.values()) {
    values.sort(sortStrings);
  }
  if (!hasTsconfig) {
    try {
      if (io.existsSync(path.join(rootAbs, 'tsconfig.json'))) {
        hasTsconfig = true;
      }
    } catch {}
  }
  return { rootAbs, fileSet, fileLower, hasTsconfig, pathTrie, dirIndex };
};

export const resolveFromLookup = (relPath, lookup) => {
  if (!relPath) return null;
  const normalized = normalizeRelPath(relPath);
  if (lookup.fileSet.has(normalized)) return normalized;
  const lower = normalized.toLowerCase();
  if (lookup.fileLower.has(lower)) return lookup.fileLower.get(lower);
  return null;
};

export const resolveCandidate = (relPath, lookup) => {
  if (!relPath) return null;
  const normalized = normalizeRelPath(relPath);
  const trimmed = normalized.replace(/\/+$/, '');
  const ext = path.posix.extname(trimmed);
  if (ext) {
    return resolveFromLookup(trimmed, lookup);
  }
  const trieKey = stripImportExtension(trimmed);
  if (lookup?.pathTrie && trieKey && !trieHasPrefix(lookup.pathTrie, trieKey)) {
    return null;
  }
  return resolveRelativeImportCandidate(trimmed, {
    extensions: DEFAULT_IMPORT_EXTS,
    resolve: (candidate) => resolveFromLookup(candidate, lookup)
  });
};

export const listFilesInDir = ({ dir, lookup, ext = null }) => {
  const normalizedDir = normalizeRelPath(dir);
  if (!normalizedDir || normalizedDir.startsWith('/')) return [];
  const values = lookup?.dirIndex?.get(normalizedDir) || [];
  if (!ext) return values.slice();
  const lowerExt = ext.toLowerCase();
  return values.filter((relPath) => relPath.toLowerCase().endsWith(lowerExt));
};

export { resolveWithinRoot };

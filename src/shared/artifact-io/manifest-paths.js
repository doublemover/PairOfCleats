import fs from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES } from './constants.js';
import { readJsonFile } from './json.js';
import { fromPosix, isAbsolutePathNative, isRelativePathEscape, toPosix } from '../files.js';
import { logLine } from '../progress.js';
import { joinPathSafe } from '../path-normalize.js';

const warnedUnsafePaths = new Set();

export const CHUNK_META_PARTS_DIR = 'chunk_meta.parts';
export const CHUNK_META_PART_PREFIX = 'chunk_meta.part-';
export const CHUNK_META_PART_EXTENSIONS = ['.jsonl', '.jsonl.gz', '.jsonl.zst'];
export const TOKEN_POSTINGS_SHARDS_DIR = 'token_postings.shards';
export const TOKEN_POSTINGS_PART_PREFIX = 'token_postings.part-';
export const TOKEN_POSTINGS_PART_EXTENSIONS = ['.json', '.json.gz', '.json.zst'];

const isSafeManifestPath = (value) => {
  if (typeof value !== 'string') return false;
  if (!value) return false;
  if (isAbsolutePathNative(value)) return false;
  const normalized = toPosix(value);
  if (normalized.startsWith('/')) return false;
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..')) return false;
  return true;
};

const warnUnsafePath = (dir, relPath, reason) => {
  const key = `${dir}:${relPath}:${reason}`;
  if (warnedUnsafePaths.has(key)) return;
  warnedUnsafePaths.add(key);
  logLine(`[manifest] Non-strict mode: skipping unsafe path (${reason}): ${relPath}`, { kind: 'warning' });
};

export const resolveManifestPath = (dir, relPath, strict) => {
  if (!relPath) return null;
  if (!isSafeManifestPath(relPath)) {
    if (strict) {
      const err = new Error(`Invalid manifest path: ${relPath}`);
      err.code = 'ERR_MANIFEST_PATH';
      throw err;
    }
    warnUnsafePath(dir, relPath, 'invalid');
    return null;
  }
  const resolved = path.resolve(dir, fromPosix(relPath));
  const root = path.resolve(dir);
  const relative = path.relative(root, resolved);
  const escapes = isRelativePathEscape(relative) || isAbsolutePathNative(relative);
  if (escapes) {
    if (strict) {
      const err = new Error(`Manifest path escapes index root: ${relPath}`);
      err.code = 'ERR_MANIFEST_PATH';
      throw err;
    }
    warnUnsafePath(dir, relPath, 'escape');
    return null;
  }
  return resolved;
};

export const normalizeMetaParts = (parts) => {
  if (!Array.isArray(parts)) return [];
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && typeof part.path === 'string') return part.path;
      return null;
    })
    .filter(Boolean);
};

export const expandMetaPartPaths = (parts, baseDir) => {
  if (!baseDir || typeof baseDir !== 'string') return [];
  const entries = normalizeMetaParts(parts);
  if (!entries.length) return [];
  return entries
    .map((part) => joinPathSafe(baseDir, [fromPosix(part)]))
    .filter(Boolean);
};

export const expandChunkMetaParts = (metaFields, baseDir) => (
  expandMetaPartPaths(metaFields?.parts, baseDir)
);

const isStrictShardFileName = (name, prefix, allowedExtensions) => {
  if (typeof name !== 'string' || typeof prefix !== 'string' || !prefix) return false;
  if (!name.startsWith(prefix)) return false;
  const matchedExt = allowedExtensions.find((ext) => name.endsWith(ext));
  if (!matchedExt) return false;
  const stem = name.slice(0, name.length - matchedExt.length);
  const suffix = stem.slice(prefix.length);
  if (!suffix) return false;
  for (let i = 0; i < suffix.length; i += 1) {
    const code = suffix.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
};

export const listShardFiles = (dir, prefix, extensions = ['.json', '.jsonl']) => {
  if (!dir || typeof dir !== 'string' || !fs.existsSync(dir)) return [];
  const allowed = Array.isArray(extensions) && extensions.length
    ? extensions
    : ['.json', '.jsonl'];
  return fs
    .readdirSync(dir)
    .filter((name) => isStrictShardFileName(name, prefix, allowed))
    .sort()
    .map((name) => path.join(dir, name));
};

export const locateChunkMetaShards = (
  dir,
  {
    metaPath = null,
    partsDir = null,
    metaFields = null,
    maxBytes = MAX_JSON_BYTES
  } = {}
) => {
  if (!dir || typeof dir !== 'string') {
    return {
      parts: [],
      metaPath: null,
      partsDir: null,
      meta: null,
      missing: [],
      source: null
    };
  }
  const resolvedMetaPath = typeof metaPath === 'string' && metaPath
    ? metaPath
    : path.join(dir, 'chunk_meta.meta.json');
  const resolvedPartsDir = typeof partsDir === 'string' && partsDir
    ? partsDir
    : path.join(dir, CHUNK_META_PARTS_DIR);
  let meta = metaFields?.fields && typeof metaFields.fields === 'object'
    ? metaFields.fields
    : metaFields;
  if (!meta && fs.existsSync(resolvedMetaPath)) {
    const metaRaw = readJsonFile(resolvedMetaPath, { maxBytes });
    meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
  }
  const metaPartNames = normalizeMetaParts(meta?.parts);
  const metaParts = expandChunkMetaParts(meta, dir);
  if (metaParts.length) {
    const missing = metaParts
      .map((candidate, index) => ({ candidate, relPath: metaPartNames[index] || null }))
      .filter((entry) => !fs.existsSync(entry.candidate))
      .map((entry) => entry.relPath || entry.candidate);
    return {
      parts: metaParts,
      metaPath: fs.existsSync(resolvedMetaPath) ? resolvedMetaPath : null,
      partsDir: resolvedPartsDir,
      meta: meta || null,
      missing,
      source: 'meta'
    };
  }
  return {
    parts: listShardFiles(resolvedPartsDir, CHUNK_META_PART_PREFIX, CHUNK_META_PART_EXTENSIONS),
    metaPath: fs.existsSync(resolvedMetaPath) ? resolvedMetaPath : null,
    partsDir: resolvedPartsDir,
    meta: meta || null,
    missing: [],
    source: 'directory'
  };
};

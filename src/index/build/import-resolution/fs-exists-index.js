import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { normalizeRelPath, resolveWithinRoot } from './path-utils.js';

const DEFAULT_MAX_SCAN_FILES = 200000;
const DEFAULT_SCAN_DIR_CONCURRENCY = 8;
const MAX_MAX_SCAN_FILES = 1000000;
const MAX_SCAN_DIR_CONCURRENCY = 32;
const BLOOM_BITS_PER_ENTRY = 12;
const MIN_BLOOM_BITS = 1 << 12;
const MAX_BLOOM_BITS = 1 << 25;
const DEFAULT_IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  '.pairofcleats',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage'
]);

const normalizePositiveInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

const normalizeFsExistsIndexConfig = (resolverPlugins) => {
  if (!resolverPlugins || typeof resolverPlugins !== 'object') return {};
  const direct = resolverPlugins.fsExistsIndex;
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
  const nested = resolverPlugins.buildContext?.fsExistsIndex;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
  return {};
};

const hash32 = (text, seed = 0x811c9dc5) => {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const createBloom = (entryCount = 0) => {
  const targetBits = Math.max(
    MIN_BLOOM_BITS,
    Math.min(MAX_BLOOM_BITS, Math.floor((entryCount || 0) * BLOOM_BITS_PER_ENTRY))
  );
  const sizeBits = 1 << Math.ceil(Math.log2(Math.max(1, targetBits)));
  const bytes = new Uint8Array(Math.max(1, Math.ceil(sizeBits / 8)));
  const setBit = (bitIndex) => {
    const index = bitIndex & (sizeBits - 1);
    const byteIndex = index >>> 3;
    const bitMask = 1 << (index & 7);
    bytes[byteIndex] |= bitMask;
  };
  const hasBit = (bitIndex) => {
    const index = bitIndex & (sizeBits - 1);
    const byteIndex = index >>> 3;
    const bitMask = 1 << (index & 7);
    return (bytes[byteIndex] & bitMask) !== 0;
  };
  const add = (text) => {
    const h1 = hash32(text, 0x811c9dc5);
    const h2 = hash32(text, 0x27d4eb2f);
    const h3 = hash32(text, 0x9e3779b1);
    setBit(h1);
    setBit(h2);
    setBit(h3);
  };
  const mightContain = (text) => {
    const h1 = hash32(text, 0x811c9dc5);
    const h2 = hash32(text, 0x27d4eb2f);
    const h3 = hash32(text, 0x9e3779b1);
    return hasBit(h1) && hasBit(h2) && hasBit(h3);
  };
  return {
    add,
    mightContain,
    sizeBits
  };
};

const addExactEntry = (exactByHash, relPath) => {
  const key = hash32(relPath, 0x94d049bb);
  const prior = exactByHash.get(key);
  if (!prior) {
    exactByHash.set(key, relPath);
    return;
  }
  if (typeof prior === 'string') {
    if (prior === relPath) return;
    exactByHash.set(key, [prior, relPath]);
    return;
  }
  if (!prior.includes(relPath)) prior.push(relPath);
};

const hasExactEntry = (exactByHash, relPath) => {
  const key = hash32(relPath, 0x94d049bb);
  const prior = exactByHash.get(key);
  if (!prior) return false;
  if (typeof prior === 'string') return prior === relPath;
  return prior.includes(relPath);
};

const normalizeEntryRelPath = (entry, rootAbs) => {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const rel = resolveWithinRoot(rootAbs, path.resolve(entry));
    return normalizeRelPath(rel);
  }
  const directRel = normalizeRelPath(entry.rel);
  if (directRel) return directRel;
  const abs = typeof entry.abs === 'string' ? entry.abs : null;
  if (!abs) return null;
  const rel = resolveWithinRoot(rootAbs, path.resolve(abs));
  return normalizeRelPath(rel);
};

const shouldIgnoreDirectory = (entryName, fullPath, rootAbs, ignoreDirs) => {
  if (ignoreDirs.has(entryName)) return true;
  const rel = normalizeRelPath(path.relative(rootAbs, fullPath));
  if (!rel) return false;
  const topLevel = rel.split('/')[0];
  return ignoreDirs.has(topLevel);
};

/**
 * Build a repo-local filesystem existence accelerator for import resolution.
 *
 * The index maintains:
 * - Bloom filter for fast negative checks.
 * - Exact verification map for false-positive elimination.
 *
 * If scan limits are reached, the index remains useful for positive hits but
 * negative checks become "unknown" to preserve correctness.
 *
 * @param {{
 *  root:string,
 *  entries?:Array<object|string>,
 *  resolverPlugins?:object|null
 * }} input
 * @returns {Promise<{
 *  enabled:boolean,
 *  complete:boolean,
 *  fileCount:number,
 *  indexedCount:number,
 *  truncated:boolean,
 *  bloomBits:number,
 *  lookup:(relPath:string)=>'present'|'absent'|'unknown'
 * }|null>}
 */
export const createFsExistsIndex = async ({
  root,
  entries = [],
  resolverPlugins = null
} = {}) => {
  if (!root) return null;
  const rootAbs = path.resolve(root);
  const config = normalizeFsExistsIndexConfig(resolverPlugins);
  if (config.enabled === false) {
    return {
      enabled: false,
      complete: false,
      fileCount: 0,
      indexedCount: 0,
      truncated: false,
      bloomBits: 0,
      lookup: () => 'unknown'
    };
  }
  const maxScanFiles = normalizePositiveInt(
    config.maxScanFiles,
    DEFAULT_MAX_SCAN_FILES,
    { min: 1, max: MAX_MAX_SCAN_FILES }
  );
  const dirConcurrency = normalizePositiveInt(
    config.dirConcurrency,
    DEFAULT_SCAN_DIR_CONCURRENCY,
    { min: 1, max: MAX_SCAN_DIR_CONCURRENCY }
  );
  const ignoreDirs = new Set([
    ...DEFAULT_IGNORE_DIRS,
    ...(Array.isArray(config.ignoreDirs)
      ? config.ignoreDirs
        .filter((entry) => typeof entry === 'string' && entry.trim())
        .map((entry) => entry.trim())
      : [])
  ]);

  const relPaths = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const rel = normalizeEntryRelPath(entry, rootAbs);
    if (!rel) continue;
    relPaths.add(rel);
  }

  const pendingDirs = [rootAbs];
  let scannedFiles = 0;
  let truncated = false;

  const workers = Array.from(
    { length: Math.max(1, Math.min(dirConcurrency, pendingDirs.length || dirConcurrency)) },
    async () => {
      for (;;) {
        if (truncated) return;
        const current = pendingDirs.pop();
        if (!current) return;
        let entriesInDir;
        try {
          entriesInDir = await fsPromises.readdir(current, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entriesInDir) {
          if (truncated) break;
          const fullPath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            if (shouldIgnoreDirectory(entry.name, fullPath, rootAbs, ignoreDirs)) continue;
            pendingDirs.push(fullPath);
            continue;
          }
          if (!entry.isFile()) continue;
          const rel = normalizeRelPath(path.relative(rootAbs, fullPath));
          if (!rel) continue;
          relPaths.add(rel);
          scannedFiles += 1;
          if (scannedFiles >= maxScanFiles) {
            truncated = true;
            break;
          }
        }
      }
    }
  );
  await Promise.all(workers);

  const bloom = createBloom(relPaths.size);
  const exactByHash = new Map();
  for (const rel of relPaths.values()) {
    bloom.add(rel);
    addExactEntry(exactByHash, rel);
  }
  const complete = truncated !== true;

  return {
    enabled: true,
    complete,
    fileCount: scannedFiles,
    indexedCount: relPaths.size,
    truncated,
    bloomBits: bloom.sizeBits,
    lookup: (relPath) => {
      const normalized = normalizeRelPath(relPath);
      if (!normalized) return 'unknown';
      if (!bloom.mightContain(normalized)) return complete ? 'absent' : 'unknown';
      if (hasExactEntry(exactByHash, normalized)) return 'present';
      return complete ? 'absent' : 'unknown';
    }
  };
};

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const CACHE_VERSION = 1;
const CACHE_FILE = 'import-resolution-cache.json';

const isObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
);

const normalizeCache = (raw) => {
  if (!isObject(raw)) return null;
  if (Number(raw.version) !== CACHE_VERSION) return null;
  const files = isObject(raw.files) ? raw.files : {};
  return {
    version: CACHE_VERSION,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : null,
    packageFingerprint: typeof raw.packageFingerprint === 'string' ? raw.packageFingerprint : null,
    fileSetFingerprint: typeof raw.fileSetFingerprint === 'string' ? raw.fileSetFingerprint : null,
    files
  };
};

export const resolveImportResolutionCachePath = (incrementalState) => {
  const dir = incrementalState?.incrementalDir;
  if (!dir) return null;
  return path.join(dir, CACHE_FILE);
};

export const loadImportResolutionCache = async ({ incrementalState, log = null } = {}) => {
  const cachePath = resolveImportResolutionCachePath(incrementalState);
  if (!cachePath || !fsSync.existsSync(cachePath)) {
    return {
      cache: {
        version: CACHE_VERSION,
        generatedAt: null,
        packageFingerprint: null,
        fileSetFingerprint: null,
        files: {}
      },
      cachePath
    };
  }
  try {
    const raw = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    const normalized = normalizeCache(raw);
    if (normalized) return { cache: normalized, cachePath };
  } catch (err) {
    if (typeof log === 'function') {
      log(`[imports] Failed to read import resolution cache: ${err?.message || err}`);
    }
  }
  return {
    cache: {
      version: CACHE_VERSION,
      generatedAt: null,
      packageFingerprint: null,
      fileSetFingerprint: null,
      files: {}
    },
    cachePath
  };
};

export const saveImportResolutionCache = async ({ cache, cachePath } = {}) => {
  if (!cachePath || !cache) return;
  const payload = {
    version: CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    packageFingerprint: typeof cache.packageFingerprint === 'string' ? cache.packageFingerprint : null,
    fileSetFingerprint: typeof cache.fileSetFingerprint === 'string' ? cache.fileSetFingerprint : null,
    files: isObject(cache.files) ? cache.files : {}
  };
  try {
    await fs.writeFile(cachePath, JSON.stringify(payload, null, 2));
  } catch {
    // ignore cache write failures
  }
};


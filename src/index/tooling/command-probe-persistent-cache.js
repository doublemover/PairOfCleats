import fsSync from 'node:fs';
import path from 'node:path';
import { buildLocalCacheKey } from '../../shared/cache-key.js';
import { getCacheRoot } from '../../shared/cache-roots.js';
import { isAbsolutePathNative } from '../../shared/files.js';
import { atomicWriteJsonSync } from '../../shared/io/atomic-write.js';

const COMMAND_PROBE_CACHE_SCHEMA_VERSION = 1;
const COMMAND_PROBE_CACHE_KEY_VERSION = 'tcp1';
const SHARED_COMMAND_PROBE_CACHE_SUBDIR = path.join('tooling', 'command-probes');
const TOOLING_CACHE_COMMAND_PROBE_SUBDIR = 'command-probes';
const COMMAND_PROBE_CACHE_MAX_ENTRIES = 256;
const COMMAND_PROBE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let persistentReadCount = 0;
let persistentHitCount = 0;
let persistentWriteCount = 0;

const normalizeCommandPath = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const resolved = path.resolve(raw);
  return process.platform === 'win32'
    ? resolved.toLowerCase()
    : resolved;
};

const normalizeCacheDir = (toolingConfig) => {
  if (toolingConfig?.cache?.enabled === false) return '';
  const raw = String(toolingConfig?.cache?.dir || '').trim();
  if (!raw) return '';
  return path.resolve(raw);
};

const toFiniteMtimeMs = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

const toFiniteSize = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

const toFiniteTimestampMs = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

const readCommandFingerprint = (commandPath) => {
  const normalizedPath = normalizeCommandPath(commandPath);
  if (!normalizedPath || !isAbsolutePathNative(normalizedPath)) return null;
  try {
    const stat = fsSync.statSync(normalizedPath);
    if (!stat?.isFile?.()) return null;
    return {
      path: normalizedPath,
      size: toFiniteSize(stat.size),
      mtimeMs: toFiniteMtimeMs(stat.mtimeMs)
    };
  } catch {
    return null;
  }
};

const normalizeProviderIdForCache = (value) => String(value || '').trim().toLowerCase();

const normalizeArgListForCache = (value) => (
  Array.isArray(value)
    ? value.map((entry) => String(entry ?? ''))
    : []
);

const resolvePersistentCacheRoot = (toolingConfig) => {
  if (toolingConfig?.cache?.enabled === false) return '';
  const configuredCacheDir = normalizeCacheDir(toolingConfig);
  if (configuredCacheDir) return path.join(configuredCacheDir, TOOLING_CACHE_COMMAND_PROBE_SUBDIR);
  const sharedCacheRoot = String(getCacheRoot() || '').trim();
  if (!sharedCacheRoot) return '';
  return path.join(sharedCacheRoot, SHARED_COMMAND_PROBE_CACHE_SUBDIR);
};

const resolvePersistentCacheDescriptor = ({
  providerId = null,
  command,
  args = [],
  toolingConfig
}) => {
  const cacheDir = resolvePersistentCacheRoot(toolingConfig);
  if (!cacheDir) return null;
  const fingerprint = readCommandFingerprint(command);
  if (!fingerprint) return null;
  const normalizedProviderId = normalizeProviderIdForCache(providerId);
  const normalizedArgs = normalizeArgListForCache(args);
  const keyInfo = buildLocalCacheKey({
    namespace: 'tooling-command-probe',
    version: COMMAND_PROBE_CACHE_KEY_VERSION,
    payload: {
      schemaVersion: COMMAND_PROBE_CACHE_SCHEMA_VERSION,
      providerId: normalizedProviderId,
      commandPath: fingerprint.path,
      args: normalizedArgs,
      size: fingerprint.size,
      mtimeMs: fingerprint.mtimeMs
    }
  });
  return {
    cacheDir,
    cachePath: path.join(cacheDir, `${keyInfo.digest}.json`),
    fingerprint,
    providerId: normalizedProviderId,
    args: normalizedArgs
  };
};

const isAttemptList = (value) => (
  Array.isArray(value)
  && value.every((entry) => entry && typeof entry === 'object')
);

const prunePersistentCommandProbeCacheDir = (cacheDir) => {
  if (!cacheDir) return;
  let entries;
  try {
    entries = fsSync.readdirSync(cacheDir, { withFileTypes: true });
  } catch {
    return;
  }
  const files = [];
  const cutoffMs = Date.now() - COMMAND_PROBE_CACHE_MAX_AGE_MS;
  for (const entry of entries) {
    if (!entry?.isFile?.() || !entry.name.endsWith('.json')) continue;
    const fullPath = path.join(cacheDir, entry.name);
    try {
      const stat = fsSync.statSync(fullPath);
      const size = toFiniteSize(stat.size);
      const mtimeMs = toFiniteMtimeMs(stat.mtimeMs);
      if (mtimeMs > 0 && mtimeMs < cutoffMs) {
        try { fsSync.rmSync(fullPath, { force: true }); } catch {}
        continue;
      }
      files.push({ path: fullPath, mtimeMs, size });
    } catch {}
  }
  if (files.length <= COMMAND_PROBE_CACHE_MAX_ENTRIES) return;
  files.sort((left, right) => (
    left.mtimeMs - right.mtimeMs
  ) || (
    left.size - right.size
  ) || (
    left.path.localeCompare(right.path)
  ));
  const overflow = files.length - COMMAND_PROBE_CACHE_MAX_ENTRIES;
  for (const entry of files.slice(0, overflow)) {
    try { fsSync.rmSync(entry.path, { force: true }); } catch {}
  }
};

export const readPersistentCommandProbeCache = ({
  providerId = null,
  command,
  args = [],
  toolingConfig,
  successTtlMs = null
} = {}) => {
  const descriptor = resolvePersistentCacheDescriptor({
    providerId,
    command,
    args,
    toolingConfig
  });
  if (!descriptor) return null;
  persistentReadCount += 1;
  try {
    const parsed = JSON.parse(fsSync.readFileSync(descriptor.cachePath, 'utf8'));
    if (Number(parsed?.schemaVersion) !== COMMAND_PROBE_CACHE_SCHEMA_VERSION) return null;
    if (parsed?.ok !== true) return null;
    if (normalizeProviderIdForCache(parsed?.providerId) !== descriptor.providerId) return null;
    const cachedCommand = normalizeCommandPath(parsed?.command?.path);
    if (cachedCommand !== descriptor.fingerprint.path) return null;
    const cachedArgs = normalizeArgListForCache(parsed?.args);
    if (JSON.stringify(cachedArgs) !== JSON.stringify(descriptor.args)) return null;
    if (toFiniteSize(parsed?.command?.size) !== descriptor.fingerprint.size) return null;
    if (toFiniteMtimeMs(parsed?.command?.mtimeMs) !== descriptor.fingerprint.mtimeMs) return null;
    if (!isAttemptList(parsed?.attempted)) return null;
    const ttlMs = Number(successTtlMs);
    if (Number.isFinite(ttlMs) && ttlMs >= 0) {
      const createdAtMs = toFiniteTimestampMs(parsed?.createdAt);
      if (createdAtMs <= 0) return null;
      if ((Date.now() - createdAtMs) > Math.floor(ttlMs)) return null;
    }
    persistentHitCount += 1;
    return {
      ok: true,
      attempted: parsed.attempted,
      cached: true,
      cacheSource: 'persistent'
    };
  } catch {
    return null;
  }
};

export const writePersistentCommandProbeCache = ({
  providerId = null,
  command,
  args = [],
  toolingConfig,
  attempted
} = {}) => {
  const descriptor = resolvePersistentCacheDescriptor({
    providerId,
    command,
    args,
    toolingConfig
  });
  if (!descriptor || !isAttemptList(attempted) || attempted.length === 0) return false;
  try {
    fsSync.mkdirSync(descriptor.cacheDir, { recursive: true });
    atomicWriteJsonSync(descriptor.cachePath, {
      schemaVersion: COMMAND_PROBE_CACHE_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      ok: true,
      providerId: descriptor.providerId,
      args: descriptor.args,
      command: {
        path: descriptor.fingerprint.path,
        size: descriptor.fingerprint.size,
        mtimeMs: descriptor.fingerprint.mtimeMs
      },
      attempted
    }, { spaces: 0 });
    persistentWriteCount += 1;
    prunePersistentCommandProbeCacheDir(descriptor.cacheDir);
    return true;
  } catch {
    return false;
  }
};

export const invalidatePersistentCommandProbeCache = ({
  providerId = null,
  command,
  args = [],
  toolingConfig
} = {}) => {
  const descriptor = resolvePersistentCacheDescriptor({
    providerId,
    command,
    args,
    toolingConfig
  });
  if (!descriptor) return false;
  try {
    fsSync.rmSync(descriptor.cachePath, { force: true });
    return true;
  } catch {
    return false;
  }
};

export const __resetPersistentCommandProbeCacheRuntimeStatsForTests = () => {
  persistentReadCount = 0;
  persistentHitCount = 0;
  persistentWriteCount = 0;
};

export const __getPersistentCommandProbeCacheRuntimeStatsForTests = () => ({
  persistentReads: persistentReadCount,
  persistentHits: persistentHitCount,
  persistentWrites: persistentWriteCount
});

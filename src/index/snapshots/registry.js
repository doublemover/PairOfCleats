import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { acquireIndexLock } from '../build/lock.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { isAbsolutePathAny, toPosix } from '../../shared/files.js';
import { atomicWriteText } from '../../shared/io/atomic-write.js';
import { stableStringify } from '../../shared/stable-json.js';
import { isManifestPathSafe } from '../validate/paths.js';

const SNAPSHOTS_DIR = 'snapshots';
const SNAPSHOT_ID_RE = /^snap-[A-Za-z0-9._-]+$/;
const DEFAULT_STAGING_MAX_AGE_HOURS = 24;

const queueError = (message, details = null) => createError(ERROR_CODES.QUEUE_OVERLOADED, message, details);
const invalidRequest = (message, details = null) => createError(ERROR_CODES.INVALID_REQUEST, message, details);

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const resolveSnapshotsRoot = (repoCacheRoot) => path.join(repoCacheRoot, SNAPSHOTS_DIR);
const resolveManifestPath = (repoCacheRoot) => path.join(resolveSnapshotsRoot(repoCacheRoot), 'manifest.json');
const resolveSnapshotDir = (repoCacheRoot, snapshotId) => (
  path.join(resolveSnapshotsRoot(repoCacheRoot), snapshotId)
);
const resolveSnapshotPath = (repoCacheRoot, snapshotId) => (
  path.join(resolveSnapshotDir(repoCacheRoot, snapshotId), 'snapshot.json')
);
const resolveFrozenPath = (repoCacheRoot, snapshotId) => (
  path.join(resolveSnapshotDir(repoCacheRoot, snapshotId), 'frozen.json')
);

const ensureSnapshotId = (snapshotId) => {
  if (typeof snapshotId !== 'string' || !SNAPSHOT_ID_RE.test(snapshotId)) {
    throw invalidRequest(`Invalid snapshot id: ${snapshotId}`);
  }
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const assertNoAbsolutePathLeak = (value, cursor = '$') => {
  if (typeof value === 'string') {
    if (isAbsolutePathAny(value)) {
      throw invalidRequest(`Absolute path leak at ${cursor}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertNoAbsolutePathLeak(value[i], `${cursor}[${i}]`);
    }
    return;
  }
  if (!isObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    assertNoAbsolutePathLeak(entry, `${cursor}.${key}`);
  }
};

const normalizeRelativePath = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidRequest(`${label} must be a non-empty path string.`);
  }
  const normalized = toPosix(value.trim());
  if (!isManifestPathSafe(normalized)) {
    throw invalidRequest(`${label} must be repo-cache-relative and traversal-safe.`);
  }
  return normalized;
};

const sanitizeSnapshotManifest = (manifest) => {
  const next = deepClone(manifest);
  assertNoAbsolutePathLeak(next);
  return next;
};

const sanitizeSnapshotRecord = (snapshotJson) => {
  const next = deepClone(snapshotJson);
  const pointer = isObject(next.pointer) ? next.pointer : null;
  if (pointer && isObject(pointer.buildRootsByMode)) {
    for (const [mode, entry] of Object.entries(pointer.buildRootsByMode)) {
      pointer.buildRootsByMode[mode] = normalizeRelativePath(
        entry,
        `pointer.buildRootsByMode.${mode}`
      );
    }
  }
  if (pointer && typeof pointer.buildRoot === 'string') {
    pointer.buildRoot = normalizeRelativePath(pointer.buildRoot, 'pointer.buildRoot');
  }
  if (typeof next.buildRoot === 'string') {
    next.buildRoot = normalizeRelativePath(next.buildRoot, 'buildRoot');
  }
  assertNoAbsolutePathLeak(next);
  return next;
};

const sanitizeFrozenRecord = (frozenJson) => {
  const next = deepClone(frozenJson);
  if (typeof next.frozenRoot === 'string') {
    next.frozenRoot = normalizeRelativePath(next.frozenRoot, 'frozenRoot');
  }
  assertNoAbsolutePathLeak(next);
  return next;
};

const readJsonObject = (filePath, fallback = null) => {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isObject(payload)) {
      throw new Error('payload must be an object');
    }
    return payload;
  } catch (err) {
    throw invalidRequest(`Invalid JSON at ${filePath}: ${err?.message || err}`, { cause: err });
  }
};

const writeStableJson = async (filePath, payload) => {
  await atomicWriteText(filePath, stableStringify(payload), { newline: true });
};

const withIndexLock = async (repoCacheRoot, options, worker) => {
  const lockInput = isObject(options?.lock) ? options.lock : null;
  if (lockInput && typeof lockInput.release === 'function') {
    return worker(lockInput);
  }
  const lock = await acquireIndexLock({
    repoCacheRoot,
    waitMs: Number.isFinite(options?.waitMs) ? Number(options.waitMs) : 0,
    pollMs: Number.isFinite(options?.pollMs) ? Number(options.pollMs) : 1000,
    staleMs: Number.isFinite(options?.staleMs) ? Number(options.staleMs) : undefined,
    log: typeof options?.log === 'function' ? options.log : () => {}
  });
  if (!lock) {
    throw queueError('Index lock held; unable to write snapshot registry.');
  }
  try {
    return await worker(lock);
  } finally {
    await lock.release();
  }
};

export const createEmptySnapshotsManifest = () => ({
  version: 1,
  updatedAt: null,
  snapshots: {},
  tags: {}
});

export const loadSnapshotsManifest = (repoCacheRoot) => (
  readJsonObject(resolveManifestPath(repoCacheRoot), createEmptySnapshotsManifest())
);

export const loadSnapshot = (repoCacheRoot, snapshotId) => {
  ensureSnapshotId(snapshotId);
  return readJsonObject(resolveSnapshotPath(repoCacheRoot, snapshotId), null);
};

export const loadFrozen = (repoCacheRoot, snapshotId) => {
  ensureSnapshotId(snapshotId);
  return readJsonObject(resolveFrozenPath(repoCacheRoot, snapshotId), null);
};

export const writeSnapshotsManifest = async (repoCacheRoot, manifest, options = {}) => {
  if (!isObject(manifest)) {
    throw invalidRequest('Snapshot manifest must be an object.');
  }
  const sanitized = sanitizeSnapshotManifest(manifest);
  return withIndexLock(repoCacheRoot, options, async () => {
    const manifestPath = resolveManifestPath(repoCacheRoot);
    await fsPromises.mkdir(path.dirname(manifestPath), { recursive: true });
    await writeStableJson(manifestPath, sanitized);
    return manifestPath;
  });
};

export const writeSnapshot = async (repoCacheRoot, snapshotId, snapshotJson, options = {}) => {
  ensureSnapshotId(snapshotId);
  if (!isObject(snapshotJson)) {
    throw invalidRequest('snapshot.json payload must be an object.');
  }
  const sanitized = sanitizeSnapshotRecord(snapshotJson);
  return withIndexLock(repoCacheRoot, options, async () => {
    const snapshotPath = resolveSnapshotPath(repoCacheRoot, snapshotId);
    await fsPromises.mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeStableJson(snapshotPath, sanitized);
    return snapshotPath;
  });
};

export const writeFrozen = async (repoCacheRoot, snapshotId, frozenJson, options = {}) => {
  ensureSnapshotId(snapshotId);
  if (!isObject(frozenJson)) {
    throw invalidRequest('frozen.json payload must be an object.');
  }
  const sanitized = sanitizeFrozenRecord(frozenJson);
  return withIndexLock(repoCacheRoot, options, async () => {
    const frozenPath = resolveFrozenPath(repoCacheRoot, snapshotId);
    await fsPromises.mkdir(path.dirname(frozenPath), { recursive: true });
    await writeStableJson(frozenPath, sanitized);
    return frozenPath;
  });
};

const collectStagingDirs = async (snapshotsRoot) => {
  const out = [];
  if (!fs.existsSync(snapshotsRoot)) return out;
  const entries = await fsPromises.readdir(snapshotsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(snapshotsRoot, entry.name);
    if (entry.name.startsWith('frozen.staging-')) {
      out.push(entryPath);
      continue;
    }
    const nested = await fsPromises.readdir(entryPath, { withFileTypes: true });
    for (const nestedEntry of nested) {
      if (!nestedEntry.isDirectory()) continue;
      if (!nestedEntry.name.startsWith('frozen.staging-')) continue;
      out.push(path.join(entryPath, nestedEntry.name));
    }
  }
  return out;
};

export const cleanupStaleFrozenStagingDirs = async (repoCacheRoot, options = {}) => {
  const maxAgeHours = Number.isFinite(options.maxAgeHours)
    ? Math.max(1, Number(options.maxAgeHours))
    : DEFAULT_STAGING_MAX_AGE_HOURS;
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

  return withIndexLock(repoCacheRoot, options, async () => {
    const snapshotsRoot = resolveSnapshotsRoot(repoCacheRoot);
    const candidates = await collectStagingDirs(snapshotsRoot);
    const removed = [];
    for (const dirPath of candidates) {
      let stat = null;
      try {
        stat = await fsPromises.stat(dirPath);
      } catch {
        continue;
      }
      if (!stat) continue;
      const ageMs = Math.max(0, nowMs - Number(stat.mtimeMs || 0));
      if (ageMs < maxAgeMs) continue;
      await fsPromises.rm(dirPath, { recursive: true, force: true });
      removed.push(dirPath);
    }
    return {
      scanned: candidates.length,
      removed
    };
  });
};

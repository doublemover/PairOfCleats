import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  assertNoAbsolutePathLeak,
  deepCloneRegistryJson,
  ensureRegistryId,
  isRegistryObject,
  normalizeRegistryRelativePath,
  readRegistryJsonObject,
  registryInvalidRequest,
  withRegistryLock,
  writeRegistryStableJson
} from '../registry-support.js';

const SNAPSHOTS_DIR = 'snapshots';
const SNAPSHOT_ID_RE = /^snap-[A-Za-z0-9._-]+$/;
const DEFAULT_STAGING_MAX_AGE_HOURS = 24;

const invalidRequest = registryInvalidRequest;
const isObject = isRegistryObject;

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
  ensureRegistryId(snapshotId, SNAPSHOT_ID_RE, `Invalid snapshot id: ${snapshotId}`);
};

const sanitizeSnapshotManifest = (manifest) => {
  const next = deepCloneRegistryJson(manifest);
  assertNoAbsolutePathLeak(next);
  return next;
};

const sanitizeSnapshotRecord = (snapshotJson) => {
  const next = deepCloneRegistryJson(snapshotJson);
  const pointer = isObject(next.pointer) ? next.pointer : null;
  if (pointer && isObject(pointer.buildRootsByMode)) {
    for (const [mode, entry] of Object.entries(pointer.buildRootsByMode)) {
      pointer.buildRootsByMode[mode] = normalizeRegistryRelativePath(
        entry,
        `pointer.buildRootsByMode.${mode}`
      );
    }
  }
  if (pointer && typeof pointer.buildRoot === 'string') {
    pointer.buildRoot = normalizeRegistryRelativePath(pointer.buildRoot, 'pointer.buildRoot');
  }
  if (typeof next.buildRoot === 'string') {
    next.buildRoot = normalizeRegistryRelativePath(next.buildRoot, 'buildRoot');
  }
  assertNoAbsolutePathLeak(next);
  return next;
};

const sanitizeFrozenRecord = (frozenJson) => {
  const next = deepCloneRegistryJson(frozenJson);
  if (typeof next.frozenRoot === 'string') {
    next.frozenRoot = normalizeRegistryRelativePath(next.frozenRoot, 'frozenRoot');
  }
  assertNoAbsolutePathLeak(next);
  return next;
};

const withIndexLock = async (repoCacheRoot, options, worker) => (
  withRegistryLock({
    repoCacheRoot,
    domain: 'snapshots',
    options,
    lockHeldMessage: 'Snapshot registry lock held; unable to write snapshot registry.',
    worker
  })
);

export const createEmptySnapshotsManifest = () => ({
  version: 1,
  updatedAt: null,
  snapshots: {},
  tags: {}
});

export const loadSnapshotsManifest = (repoCacheRoot) => (
  readRegistryJsonObject(resolveManifestPath(repoCacheRoot), createEmptySnapshotsManifest())
);

export const loadSnapshot = (repoCacheRoot, snapshotId) => {
  ensureSnapshotId(snapshotId);
  return readRegistryJsonObject(resolveSnapshotPath(repoCacheRoot, snapshotId), null);
};

export const loadFrozen = (repoCacheRoot, snapshotId) => {
  ensureSnapshotId(snapshotId);
  return readRegistryJsonObject(resolveFrozenPath(repoCacheRoot, snapshotId), null);
};

export const writeSnapshotsManifest = async (repoCacheRoot, manifest, options = {}) => {
  if (!isObject(manifest)) {
    throw invalidRequest('Snapshot manifest must be an object.');
  }
  const sanitized = sanitizeSnapshotManifest(manifest);
  return withIndexLock(repoCacheRoot, options, async () => {
    const manifestPath = resolveManifestPath(repoCacheRoot);
    await fsPromises.mkdir(path.dirname(manifestPath), { recursive: true });
    await writeRegistryStableJson(manifestPath, sanitized);
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
    await writeRegistryStableJson(snapshotPath, sanitized);
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
    await writeRegistryStableJson(frozenPath, sanitized);
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

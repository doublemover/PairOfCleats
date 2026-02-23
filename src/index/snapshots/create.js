import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { acquireIndexLock } from '../build/lock.js';
import { resolveIndexRef } from '../index-ref.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { isManifestPathSafe } from '../validate/paths.js';
import { toPosix } from '../../shared/files.js';
import { sha1 } from '../../shared/hash.js';
import { getRepoCacheRoot, getRepoId } from '../../shared/dict-utils.js';
import { isWithinRoot, toRealPathSync } from '../../workspace/identity.js';
import {
  loadSnapshot,
  loadSnapshotsManifest,
  writeSnapshot,
  writeSnapshotsManifest
} from './registry.js';

const SNAPSHOT_ID_RE = /^snap-[A-Za-z0-9._-]+$/;
const VALID_MODES = ['code', 'prose', 'extracted-prose', 'records'];
const DEFAULT_MAX_POINTER_SNAPSHOTS = 25;

const invalidRequest = (message, details = null) => createError(ERROR_CODES.INVALID_REQUEST, message, details);
const notFound = (message, details = null) => createError(ERROR_CODES.NOT_FOUND, message, details);
const queueError = (message, details = null) => createError(ERROR_CODES.QUEUE_OVERLOADED, message, details);

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const normalizeModes = (input) => {
  const raw = Array.isArray(input)
    ? input
    : String(input || '')
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean);
  const normalized = [];
  for (const modeRaw of raw) {
    const mode = String(modeRaw).trim().toLowerCase();
    if (!mode) continue;
    if (!VALID_MODES.includes(mode)) {
      throw invalidRequest(`Invalid mode "${mode}". Use ${VALID_MODES.join('|')}.`);
    }
    if (!normalized.includes(mode)) normalized.push(mode);
  }
  return normalized.length ? normalized : [...VALID_MODES];
};

const normalizeTags = (input) => {
  const raw = Array.isArray(input)
    ? input
    : String(input || '')
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const tag of raw) {
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
};

const ensureSnapshotId = (snapshotId) => {
  if (typeof snapshotId !== 'string' || !SNAPSHOT_ID_RE.test(snapshotId)) {
    throw invalidRequest(`Invalid snapshot id "${snapshotId}".`);
  }
};

const generateSnapshotId = (now = new Date()) => {
  const y = String(now.getUTCFullYear()).padStart(4, '0');
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const s = String(now.getUTCSeconds()).padStart(2, '0');
  const token = crypto.randomBytes(3).toString('hex');
  return `snap-${y}${mo}${d}${h}${mi}${s}-${token}`;
};

const relativeToRepoCache = (repoCacheRoot, absolutePath, label) => {
  const root = toRealPathSync(path.resolve(repoCacheRoot));
  const resolved = toRealPathSync(path.resolve(absolutePath));
  if (!isWithinRoot(resolved, root)) {
    throw invalidRequest(`${label} escapes repo cache root.`);
  }
  const relative = toPosix(path.relative(root, resolved));
  if (!isManifestPathSafe(relative)) {
    throw invalidRequest(`${label} must be repo-cache-relative and traversal-safe.`);
  }
  return relative;
};

const readBuildStateStrict = (indexBaseRoot, mode) => {
  const statePath = path.join(indexBaseRoot, 'build_state.json');
  if (!fs.existsSync(statePath)) {
    throw notFound(`Missing build_state.json for ${mode}.`);
  }
  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (err) {
    throw invalidRequest(`Invalid build_state.json for ${mode}: ${err?.message || err}`, { cause: err });
  }
  if (!isObject(state)) {
    throw invalidRequest(`Invalid build_state.json for ${mode}: expected object.`);
  }
  const validation = state.validation;
  if (!isObject(validation) || validation.ok !== true) {
    throw invalidRequest(`Snapshot creation requires validation.ok === true for ${mode}.`);
  }
  return state;
};

const sortSnapshotEntries = (entries) => {
  entries.sort((left, right) => {
    const leftAt = String(left.createdAt || '');
    const rightAt = String(right.createdAt || '');
    if (leftAt !== rightAt) return rightAt.localeCompare(leftAt);
    return String(left.snapshotId || '').localeCompare(String(right.snapshotId || ''));
  });
  return entries;
};

const updateTagIndex = (manifest) => {
  const tags = {};
  for (const entry of Object.values(manifest.snapshots || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const snapshotId = entry.snapshotId;
    if (typeof snapshotId !== 'string' || !snapshotId) continue;
    const entryTags = Array.isArray(entry.tags) ? entry.tags : [];
    for (const tag of entryTags) {
      if (typeof tag !== 'string' || !tag) continue;
      if (!tags[tag]) tags[tag] = [];
      tags[tag].push(snapshotId);
    }
  }
  for (const [tag, ids] of Object.entries(tags)) {
    ids.sort((a, b) => {
      const left = manifest.snapshots?.[a];
      const right = manifest.snapshots?.[b];
      const leftAt = String(left?.createdAt || '');
      const rightAt = String(right?.createdAt || '');
      if (leftAt !== rightAt) return rightAt.localeCompare(leftAt);
      return a.localeCompare(b);
    });
    tags[tag] = ids;
  }
  manifest.tags = tags;
};

const prunePointerSnapshots = async ({
  repoCacheRoot,
  manifest,
  maxPointerSnapshots = DEFAULT_MAX_POINTER_SNAPSHOTS,
  dryRun = false
}) => {
  const pointerEntries = sortSnapshotEntries(
    Object.values(manifest.snapshots || {}).filter((entry) => (
      entry?.kind === 'pointer' && entry?.hasFrozen !== true
    ))
  );
  const keepIds = new Set();
  const protectedByTag = new Set();
  for (const entry of pointerEntries) {
    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    if (tags.length > 0) protectedByTag.add(entry.snapshotId);
  }

  let keptUntagged = 0;
  for (const entry of pointerEntries) {
    const snapshotId = entry.snapshotId;
    if (!snapshotId) continue;
    if (protectedByTag.has(snapshotId)) {
      keepIds.add(snapshotId);
      continue;
    }
    if (keptUntagged < maxPointerSnapshots) {
      keepIds.add(snapshotId);
      keptUntagged += 1;
    }
  }

  const removed = [];
  for (const entry of pointerEntries) {
    const snapshotId = entry.snapshotId;
    if (!snapshotId || keepIds.has(snapshotId)) continue;
    removed.push(snapshotId);
    if (!dryRun) {
      delete manifest.snapshots[snapshotId];
      await fsPromises.rm(path.join(repoCacheRoot, 'snapshots', snapshotId), {
        recursive: true,
        force: true
      });
    }
  }
  if (removed.length && !dryRun) {
    updateTagIndex(manifest);
  }
  return removed;
};

const withSnapshotLock = async (repoCacheRoot, options, worker) => {
  const lock = await acquireIndexLock({
    repoCacheRoot,
    waitMs: Number.isFinite(options?.waitMs) ? Number(options.waitMs) : 0,
    pollMs: Number.isFinite(options?.pollMs) ? Number(options.pollMs) : 1000,
    staleMs: Number.isFinite(options?.staleMs) ? Number(options.staleMs) : undefined,
    log: typeof options?.log === 'function' ? options.log : () => {}
  });
  if (!lock) {
    throw queueError('Index lock held; unable to mutate snapshots.');
  }
  try {
    return await worker(lock);
  } finally {
    await lock.release();
  }
};

export const createPointerSnapshot = async ({
  repoRoot,
  userConfig = null,
  modes = [],
  tags = [],
  label = null,
  snapshotId = null,
  waitMs = 0,
  maxPointerSnapshots = DEFAULT_MAX_POINTER_SNAPSHOTS
} = {}) => {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw invalidRequest('repoRoot is required.');
  }
  const resolvedRepoRoot = path.resolve(repoRoot);
  const normalizedModes = normalizeModes(modes);
  const normalizedTags = normalizeTags(tags);
  const repoCacheRoot = getRepoCacheRoot(resolvedRepoRoot, userConfig);
  const now = new Date();
  const createdAt = now.toISOString();
  const selectedSnapshotId = snapshotId || generateSnapshotId(now);
  ensureSnapshotId(selectedSnapshotId);

  return withSnapshotLock(repoCacheRoot, { waitMs }, async (lock) => {
    const resolved = resolveIndexRef({
      ref: 'latest',
      repoRoot: resolvedRepoRoot,
      userConfig,
      requestedModes: normalizedModes,
      preferFrozen: true,
      allowMissingModes: false
    });
    const manifest = loadSnapshotsManifest(repoCacheRoot);
    if (manifest.snapshots?.[selectedSnapshotId]) {
      throw invalidRequest(`Snapshot already exists: ${selectedSnapshotId}`);
    }
    const snapshotDir = path.join(repoCacheRoot, 'snapshots', selectedSnapshotId);
    if (fs.existsSync(snapshotDir)) {
      throw invalidRequest(`Snapshot directory already exists: ${selectedSnapshotId}`);
    }

    const buildRootsByMode = {};
    const buildIdByMode = {};
    const configHashByMode = {};
    const toolVersionByMode = {};
    let repoProvenance = null;

    for (const mode of normalizedModes) {
      const indexBaseRoot = resolved.indexBaseRootByMode?.[mode];
      if (!indexBaseRoot) {
        throw notFound(`Missing resolved index base root for ${mode}.`);
      }
      const buildState = readBuildStateStrict(indexBaseRoot, mode);
      buildRootsByMode[mode] = relativeToRepoCache(repoCacheRoot, indexBaseRoot, `buildRoot (${mode})`);
      const buildId = typeof buildState.buildId === 'string' && buildState.buildId
        ? buildState.buildId
        : path.basename(indexBaseRoot);
      buildIdByMode[mode] = buildId;
      configHashByMode[mode] = buildState.configHash == null ? null : String(buildState.configHash);
      toolVersionByMode[mode] = buildState.tool?.version == null ? null : String(buildState.tool.version);
      if (!repoProvenance && isObject(buildState.repo)) {
        repoProvenance = buildState.repo;
      }
    }

    const snapshotJson = {
      version: 1,
      snapshotId: selectedSnapshotId,
      createdAt,
      kind: 'pointer',
      label: typeof label === 'string' && label.trim() ? label.trim() : null,
      tags: normalizedTags,
      pointer: {
        buildRootsByMode,
        buildIdByMode
      },
      provenance: {
        repoId: getRepoId(resolvedRepoRoot),
        repoRootHash: sha1(path.resolve(resolvedRepoRoot)),
        git: {
          branch: repoProvenance?.branch ?? null,
          commit: repoProvenance?.commit ?? null,
          dirty: repoProvenance?.dirty ?? null
        },
        toolVersionByMode,
        configHashByMode
      }
    };

    if (!isObject(manifest.snapshots)) manifest.snapshots = {};
    if (!isObject(manifest.tags)) manifest.tags = {};
    manifest.version = Number.isFinite(manifest.version) ? manifest.version : 1;
    manifest.updatedAt = createdAt;
    manifest.snapshots[selectedSnapshotId] = {
      snapshotId: selectedSnapshotId,
      createdAt,
      kind: 'pointer',
      tags: normalizedTags,
      label: snapshotJson.label,
      hasFrozen: false
    };
    updateTagIndex(manifest);

    await writeSnapshot(repoCacheRoot, selectedSnapshotId, snapshotJson, { lock });
    const removed = await prunePointerSnapshots({
      repoCacheRoot,
      manifest,
      maxPointerSnapshots: Number.isFinite(maxPointerSnapshots)
        ? Math.max(1, Math.floor(maxPointerSnapshots))
        : DEFAULT_MAX_POINTER_SNAPSHOTS
    });
    await writeSnapshotsManifest(repoCacheRoot, manifest, { lock });

    return {
      snapshotId: selectedSnapshotId,
      createdAt,
      modes: normalizedModes,
      tags: normalizedTags,
      buildIdByMode,
      removedByRetention: removed
    };
  });
};

export const listSnapshots = ({
  repoRoot,
  userConfig = null
} = {}) => {
  const repoCacheRoot = getRepoCacheRoot(path.resolve(repoRoot), userConfig);
  const manifest = loadSnapshotsManifest(repoCacheRoot);
  return sortSnapshotEntries(
    Object.values(manifest.snapshots || {}).filter((entry) => isObject(entry))
  );
};

export const showSnapshot = ({
  repoRoot,
  userConfig = null,
  snapshotId
} = {}) => {
  ensureSnapshotId(snapshotId);
  const repoCacheRoot = getRepoCacheRoot(path.resolve(repoRoot), userConfig);
  const manifest = loadSnapshotsManifest(repoCacheRoot);
  const entry = manifest.snapshots?.[snapshotId] || null;
  if (!entry) return null;
  const snapshot = loadSnapshot(repoCacheRoot, snapshotId);
  return { entry, snapshot };
};

export const removeSnapshot = async ({
  repoRoot,
  userConfig = null,
  snapshotId,
  force = false,
  waitMs = 0
} = {}) => {
  ensureSnapshotId(snapshotId);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const repoCacheRoot = getRepoCacheRoot(resolvedRepoRoot, userConfig);
  return withSnapshotLock(repoCacheRoot, { waitMs }, async (lock) => {
    const manifest = loadSnapshotsManifest(repoCacheRoot);
    const entry = manifest.snapshots?.[snapshotId];
    if (!entry) {
      throw notFound(`Snapshot not found: ${snapshotId}`);
    }
    if (entry.hasFrozen === true && force !== true) {
      throw invalidRequest(`Snapshot ${snapshotId} is frozen. Use --force to remove.`);
    }
    await fsPromises.rm(path.join(repoCacheRoot, 'snapshots', snapshotId), {
      recursive: true,
      force: true
    });
    delete manifest.snapshots[snapshotId];
    updateTagIndex(manifest);
    manifest.updatedAt = new Date().toISOString();
    await writeSnapshotsManifest(repoCacheRoot, manifest, { lock });
    return { removed: snapshotId };
  });
};

export const pruneSnapshots = async ({
  repoRoot,
  userConfig = null,
  maxPointerSnapshots = DEFAULT_MAX_POINTER_SNAPSHOTS,
  waitMs = 0,
  dryRun = false
} = {}) => {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw invalidRequest('repoRoot is required.');
  }
  const resolvedRepoRoot = path.resolve(repoRoot);
  const repoCacheRoot = getRepoCacheRoot(resolvedRepoRoot, userConfig);
  return withSnapshotLock(repoCacheRoot, { waitMs }, async (lock) => {
    const manifest = loadSnapshotsManifest(repoCacheRoot);
    const removed = await prunePointerSnapshots({
      repoCacheRoot,
      manifest,
      maxPointerSnapshots: Number.isFinite(maxPointerSnapshots)
        ? Math.max(1, Math.floor(maxPointerSnapshots))
        : DEFAULT_MAX_POINTER_SNAPSHOTS,
      dryRun: dryRun === true
    });
    if (removed.length && dryRun !== true) {
      manifest.updatedAt = new Date().toISOString();
      await writeSnapshotsManifest(repoCacheRoot, manifest, { lock });
    }
    return { removed, dryRun: dryRun === true };
  });
};

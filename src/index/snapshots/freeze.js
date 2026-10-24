import { readJsonFile } from '../../shared/artifact-io/json.js';
import { sha256File } from '../../shared/hash.js';
import { readFrozenModeState } from './mode-provenance.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { fromPosix, isAbsolutePathAny, toPosix } from '../../shared/file-paths.js';
import { getRepoCacheRoot } from '../../shared/dict-utils.js';
import { isWithinRoot, toRealPathSync } from '../../workspace/identity.js';
import { isManifestPathSafe } from '../validate/paths.js';
import { validateArtifact } from '../../contracts/validators/artifacts.js';
import { withRegistryLock } from '../registry-support.js';
import {
  cleanupStaleFrozenStagingDirs,
  loadFrozen,
  loadSnapshot,
  loadSnapshotsManifest,
  resolveSnapshotDir,
  writeFrozen,
  writeSnapshotsManifest
} from './registry.js';
import {
  assertSnapshotSourcePath,
  copySnapshotDirectory,
  copySnapshotFile,
  copySnapshotModeArtifacts
} from './copy-pieces.js';
import {
  buildSnapshotLockConflict,
  buildSnapshotRetention,
  resolveSnapshotRetentionPolicy
} from './support.js';

const SNAPSHOT_ID_RE = /^snap-[A-Za-z0-9._-]+$/;
const VALID_MODES = ['code', 'prose', 'extracted-prose', 'records'];
const DEFAULT_KEEP_POINTER = 50;
const DEFAULT_KEEP_FROZEN = 20;
const DEFAULT_KEEP_TAGS = ['release/*', 'release'];

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const invalidRequest = (message, details = null) => createError(ERROR_CODES.INVALID_REQUEST, message, details);
const notFound = (message, details = null) => createError(ERROR_CODES.NOT_FOUND, message, details);

const ensureSnapshotId = (snapshotId) => {
  if (typeof snapshotId !== 'string' || !SNAPSHOT_ID_RE.test(snapshotId)) {
    throw invalidRequest(`Invalid snapshot id "${snapshotId}".`);
  }
};

const normalizeMethod = (method) => {
  const normalized = String(method || 'copy').trim().toLowerCase();
  if (normalized === 'copy' || normalized === 'hardlink') return 'copy';
  throw invalidRequest(`Invalid freeze method "${method}". Use hardlink|copy.`);
};

const normalizeModes = (input, fallbackModes) => {
  const raw = Array.isArray(input)
    ? input
    : String(input || '')
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean);
  const selected = [];
  for (const token of raw) {
    const mode = String(token || '').trim().toLowerCase();
    if (!mode) continue;
    if (!VALID_MODES.includes(mode)) {
      throw invalidRequest(`Invalid mode "${mode}". Use ${VALID_MODES.join('|')}.`);
    }
    if (!selected.includes(mode)) selected.push(mode);
  }
  if (selected.length) return selected;
  return [...fallbackModes];
};

const resolveCacheRelativePath = (repoCacheRoot, relativePath, label) => {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw invalidRequest(`${label} must be a non-empty path string.`);
  }
  const normalized = toPosix(relativePath.trim());
  if (!isManifestPathSafe(normalized) || isAbsolutePathAny(normalized)) {
    throw invalidRequest(`${label} must be repo-cache-relative and traversal-safe.`);
  }
  const resolved = toRealPathSync(path.resolve(repoCacheRoot, fromPosix(normalized)));
  const cacheRootResolved = toRealPathSync(path.resolve(repoCacheRoot));
  if (!isWithinRoot(resolved, cacheRootResolved)) {
    throw invalidRequest(`${label} escapes repo cache root.`);
  }
  return { normalized, resolved };
};

const normalizeIncludeSqlite = (value) => {
  if (value == null || value === '' || value === 'auto') return 'auto';
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  if (normalized === 'auto') return 'auto';
  throw invalidRequest(`Invalid include-sqlite value "${value}". Use auto|true|false.`);
};

const normalizeBooleanFlag = (value, fallback = false) => {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
};

const withSnapshotLock = async (repoCacheRoot, options, worker) => {
  return withRegistryLock({
    repoCacheRoot,
    domain: 'snapshots',
    options,
    createLockError: () => buildSnapshotLockConflict(
      repoCacheRoot,
      typeof options?.action === 'string' && options.action.trim()
        ? options.action.trim()
        : 'freeze snapshots',
      {
        requestedSnapshotId: typeof options?.snapshotId === 'string' ? options.snapshotId : null
      }
    ),
    worker
  });
};


const matchesTagPattern = (tag, pattern) => {
  const escaped = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(String(tag));
};

const normalizeKeepTags = (value) => {
  const raw = Array.isArray(value)
    ? value
    : String(value || '')
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
  const tags = raw.length ? raw : DEFAULT_KEEP_TAGS;
  const deduped = [];
  for (const tag of tags) {
    if (!deduped.includes(tag)) deduped.push(tag);
  }
  return deduped;
};

const parseCreatedAtMs = (value) => {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
};

const sortedSnapshotEntries = (manifest) => (
  Object.values(manifest?.snapshots || {})
    .filter((entry) => isObject(entry) && typeof entry.snapshotId === 'string' && entry.snapshotId)
    .sort((left, right) => {
      const leftMs = parseCreatedAtMs(left.createdAt);
      const rightMs = parseCreatedAtMs(right.createdAt);
      if (leftMs !== rightMs) return rightMs - leftMs;
      return String(left.snapshotId).localeCompare(String(right.snapshotId));
    })
);

const resolveSnapshotModeRoots = ({
  repoCacheRoot,
  snapshotJson,
  modes
}) => {
  const pointer = isObject(snapshotJson?.pointer) ? snapshotJson.pointer : null;
  if (!pointer) {
    throw invalidRequest(`Snapshot ${snapshotJson?.snapshotId || '<unknown>'} is missing pointer metadata.`);
  }
  const buildRootsByMode = isObject(pointer.buildRootsByMode) ? pointer.buildRootsByMode : {};
  const buildRootDefault = typeof pointer.buildRoot === 'string'
    ? pointer.buildRoot
    : (typeof snapshotJson.buildRoot === 'string' ? snapshotJson.buildRoot : null);
  const sourceRoots = {};
  for (const mode of modes) {
    const rawRoot = buildRootsByMode[mode] ?? buildRootDefault;
    if (!rawRoot) {
      throw invalidRequest(`Snapshot ${snapshotJson.snapshotId} missing build root for ${mode}.`);
    }
    const { resolved } = resolveCacheRelativePath(repoCacheRoot, rawRoot, `pointer.buildRootsByMode.${mode}`);
    sourceRoots[mode] = resolved;
  }
  return sourceRoots;
};

export const freezeSnapshot = async ({
  repoRoot,
  userConfig = null,
  snapshotId,
  modes = [],
  method = 'copy',
  verify = true,
  includeSqlite = 'auto',
  includeLmdb = false,
  retentionTier = null,
  waitMs = 0,
  stagingMaxAgeHours = 24
} = {}) => {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw invalidRequest('repoRoot is required.');
  }
  ensureSnapshotId(snapshotId);
  const normalizedMethod = normalizeMethod(method);
  const verifyEnabled = normalizeBooleanFlag(verify, true);
  const includeSqliteMode = normalizeIncludeSqlite(includeSqlite);
  const includeLmdbEnabled = normalizeBooleanFlag(includeLmdb, false);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const repoCacheRoot = getRepoCacheRoot(resolvedRepoRoot, userConfig);

  return withSnapshotLock(repoCacheRoot, {
    waitMs,
    action: 'freeze snapshot',
    snapshotId,
    metadata: {
      owner: 'snapshots',
      operation: 'freeze',
      snapshotId
    }
  }, async (lock) => {
    const manifest = loadSnapshotsManifest(repoCacheRoot);
    await cleanupStaleFrozenStagingDirs(repoCacheRoot, {
      lock,
      maxAgeHours: stagingMaxAgeHours
    });
    const entry = manifest.snapshots?.[snapshotId];
    if (!entry) {
      throw notFound(`Snapshot not found: ${snapshotId}`);
    }
    const snapshotJson = loadSnapshot(repoCacheRoot, snapshotId);
    if (!snapshotJson) {
      throw notFound(`snapshot.json missing for ${snapshotId}`);
    }
    const snapshotDir = resolveSnapshotDir(repoCacheRoot, snapshotId);
    const frozenDir = path.join(snapshotDir, 'frozen');
    const existingFrozen = loadFrozen(repoCacheRoot, snapshotId);
    if (entry.hasFrozen === true && existingFrozen && fs.existsSync(frozenDir)) {
      return {
        snapshotId,
        alreadyFrozen: true,
        frozenAt: existingFrozen.frozenAt || null,
        method: existingFrozen.method || normalizedMethod
      };
    }

    const pointerModes = Object.keys(snapshotJson?.pointer?.buildRootsByMode || {});
    const selectedModes = normalizeModes(modes, pointerModes.length ? pointerModes : VALID_MODES);
    const sourceRootByMode = resolveSnapshotModeRoots({
      repoCacheRoot,
      snapshotJson,
      modes: selectedModes
    });
    for (const [mode, sourceRoot] of Object.entries(sourceRootByMode)) {
      const sourceIndexDir = path.join(sourceRoot, `index-${mode}`);
      if (!fs.existsSync(sourceIndexDir)) {
        throw notFound(`Snapshot ${snapshotId} source index missing for ${mode}: ${sourceIndexDir}`);
      }
    }

    const stagingToken = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const stagingDir = path.join(snapshotDir, `frozen.staging-${stagingToken}`);
    await fsPromises.mkdir(stagingDir, { recursive: true });
    const cleanupStaging = async () => {
      await fsPromises.rm(stagingDir, { recursive: true, force: true });
    };

    try {
      const modeResults = [];
      const modeProvenance = {};
      for (const mode of selectedModes) {
        const sourceRoot = sourceRootByMode[mode];
        const copyResult = await copySnapshotModeArtifacts({
          sourceIndexDir: path.join(sourceRoot, `index-${mode}`),
          targetIndexDir: path.join(stagingDir, `index-${mode}`),
          method: normalizedMethod,
          verify: verifyEnabled
        });
        modeResults.push({ mode, result: copyResult });
        const statePath = path.join(sourceRoot, 'build_state.json');
        const relativeState = `provenance/${mode}.build_state.json`;
        const targetState = path.join(stagingDir, relativeState);
        const stateCopy = await copySnapshotFile({ sourceRoot, sourcePath: statePath, targetPath: targetState, verify: true });
        copyResult.filesCopied = Number(copyResult.filesCopied || 0) + 1;
        copyResult.bytesCopied = Number(copyResult.bytesCopied || 0) + stateCopy.bytes;
        const state = readJsonFile(targetState, { maxBytes: 8 * 1024 * 1024, containedRoot: stagingDir });
        const pieces = readJsonFile(path.join(stagingDir, `index-${mode}`, 'pieces', 'manifest.json'), { containedRoot: stagingDir });
        const expectedId = snapshotJson.pointer?.buildIdByMode?.[mode];
        if (!state.buildId || pieces.buildId !== state.buildId || (expectedId && expectedId !== state.buildId)) {
          throw invalidRequest(`Snapshot ${mode} state does not match its selected artifacts.`);
        }
        modeProvenance[mode] = { mode, statePath: relativeState, sha256: await sha256File(targetState),
          buildId: state.buildId, configHash: state.configHash ?? null, toolVersion: state.tool?.version ?? null,
          compatibilityKey: pieces.compatibilityKey ?? null };
        readFrozenModeState({ frozenRoot: stagingDir, mode, receipt: modeProvenance[mode] });
      }

      const optionalCopies = [];
      let includeSqliteResolved = false;
      const includeLmdbResolved = includeLmdbEnabled === true;
      for (const mode of selectedModes) {
        const sourceRoot = sourceRootByMode[mode];
        const sqliteName = `index-${mode}.db`;
        const database = path.join(sourceRoot, 'index-sqlite', sqliteName);
        const exists = fs.existsSync(database);
        if (includeSqliteMode === true && !exists) throw notFound(`Selected ${mode} SQLite source missing.`);
        if (includeSqliteMode !== false && exists) {
          const walPath = `${database}-wal`;
          if (fs.existsSync(walPath) && (await fsPromises.stat(walPath)).size > 0) throw invalidRequest(`Selected ${mode} SQLite WAL requires checkpointing before freeze.`);
          const targetPath = path.join(stagingDir, 'index-sqlite', sqliteName);
          const copied = await copySnapshotFile({ sourceRoot, sourcePath: database, targetPath, verify: true });
          if (await sha256File(database) !== await sha256File(targetPath)) throw invalidRequest(`Frozen ${mode} SQLite bytes differ.`);
          optionalCopies.push(copied);
          includeSqliteResolved = true;
        }
        if (includeLmdbResolved && ['code', 'prose'].includes(mode)) {
          const sourceDir = path.join(sourceRoot, 'index-lmdb', `index-${mode}`);
          if (!fs.existsSync(sourceDir)) throw notFound(`Selected ${mode} LMDB source missing.`);
          optionalCopies.push(...await copySnapshotDirectory({ sourceDir,
            targetDir: path.join(stagingDir, 'index-lmdb', `index-${mode}`), verify: true }));
        }
      }

      if (fs.existsSync(frozenDir)) {
        await fsPromises.rm(frozenDir, { recursive: true, force: true });
      }
      await fsPromises.rename(stagingDir, frozenDir);

      const checkedAt = new Date().toISOString();
      const filesChecked = modeResults.reduce((sum, entry) => sum + Number(entry.result.filesChecked || 0), 0)
        + (verifyEnabled ? optionalCopies.length : 0);
      const bytesChecked = modeResults.reduce((sum, entry) => sum + Number(entry.result.bytesChecked || 0), 0)
        + (verifyEnabled ? optionalCopies.reduce((sum, entry) => sum + entry.bytes, 0) : 0);
      const filesCopied = modeResults.reduce((sum, entry) => sum + Number(entry.result.filesCopied || 0), 0)
        + optionalCopies.length;
      const bytesCopied = modeResults.reduce((sum, entry) => sum + Number(entry.result.bytesCopied || 0), 0)
        + optionalCopies.reduce((sum, entry) => sum + Number(entry.bytes || 0), 0);

      const frozenJson = {
        version: 1,
        snapshotId,
        modeProvenanceVersion: 1,
        modeProvenance,
        frozenAt: checkedAt,
        method: normalizedMethod,
        frozenRoot: toPosix(path.join('snapshots', snapshotId, 'frozen')),
        included: {
          modes: selectedModes,
          sqlite: includeSqliteResolved,
          lmdb: includeLmdbResolved
        },
        verification: {
          checkedAt,
          ok: verifyEnabled,
          status: verifyEnabled ? 'verified' : 'skipped',
          filesChecked: verifyEnabled ? filesChecked : null,
          bytesChecked: verifyEnabled ? bytesChecked : null,
          failures: []
        }
      };
      const schemaValidation = validateArtifact('snapshot_frozen', frozenJson);
      if (!schemaValidation.ok) {
        throw invalidRequest(`snapshot_frozen schema invalid: ${schemaValidation.errors.join('; ')}`);
      }

      await writeFrozen(repoCacheRoot, snapshotId, frozenJson, { lock });
      manifest.version = Number.isFinite(manifest.version) ? manifest.version : 1;
      manifest.updatedAt = checkedAt;
      manifest.snapshots[snapshotId] = {
        ...entry,
        hasFrozen: true,
        retention: buildSnapshotRetention({
          retentionTier: retentionTier ?? (entry?.retention?.tier === 'pinned' ? 'pinned' : null),
          tags: Array.isArray(entry?.tags) ? entry.tags : [],
          hasFrozen: true
        })
      };
      await writeSnapshotsManifest(repoCacheRoot, manifest, { lock });
      return {
        snapshotId,
        alreadyFrozen: false,
        frozenAt: checkedAt,
        method: normalizedMethod,
        modes: selectedModes,
        includeSqlite: includeSqliteResolved,
        includeLmdb: includeLmdbResolved,
        filesCopied,
        bytesCopied,
        filesChecked: verifyEnabled ? filesChecked : null,
        bytesChecked: verifyEnabled ? bytesChecked : null,
        verificationOk: true,
        retention: manifest.snapshots[snapshotId].retention
      };
    } catch (err) {
      await cleanupStaging();
      throw err;
    }
  });
};

export const gcSnapshots = async ({
  repoRoot,
  userConfig = null,
  keepPointer = DEFAULT_KEEP_POINTER,
  keepFrozen = DEFAULT_KEEP_FROZEN,
  keepTags = DEFAULT_KEEP_TAGS,
  maxAgeDays = null,
  dryRun = false,
  waitMs = 0,
  stagingMaxAgeHours = 24
} = {}) => {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw invalidRequest('repoRoot is required.');
  }
  const resolvedRepoRoot = path.resolve(repoRoot);
  const repoCacheRoot = getRepoCacheRoot(resolvedRepoRoot, userConfig);
  const keepPointerCount = Number.isFinite(Number(keepPointer))
    ? Math.max(0, Math.floor(Number(keepPointer)))
    : DEFAULT_KEEP_POINTER;
  const keepFrozenCount = Number.isFinite(Number(keepFrozen))
    ? Math.max(0, Math.floor(Number(keepFrozen)))
    : DEFAULT_KEEP_FROZEN;
  const keepTagPatterns = normalizeKeepTags(keepTags);
  const dryRunEnabled = dryRun === true;
  const maxAgeCutoffMs = Number.isFinite(Number(maxAgeDays))
    ? (Date.now() - Math.max(0, Number(maxAgeDays)) * 24 * 60 * 60 * 1000)
    : null;

  return withSnapshotLock(repoCacheRoot, {
    waitMs,
    action: 'garbage-collect snapshots',
    metadata: {
      owner: 'snapshots',
      operation: 'gc'
    }
  }, async (lock) => {
    const manifest = loadSnapshotsManifest(repoCacheRoot);
    const staleCleanup = await cleanupStaleFrozenStagingDirs(repoCacheRoot, {
      lock,
      maxAgeHours: stagingMaxAgeHours,
      dryRun: dryRunEnabled
    });
    const entries = sortedSnapshotEntries(manifest);
    const protectedIds = new Set();
    const removedEntries = [];
    const decisions = [];
    let keptPointer = 0;
    let keptFrozen = 0;

    for (const entry of entries) {
      const snapshotId = entry?.snapshotId;
      if (typeof snapshotId !== 'string' || !snapshotId) continue;
      const tags = Array.isArray(entry.tags) ? entry.tags : [];
      const tagProtected = tags.some((tag) => (
        keepTagPatterns.some((pattern) => matchesTagPattern(tag, pattern))
      ));
      const policy = resolveSnapshotRetentionPolicy(entry, { tagProtected });
      const retentionTier = policy.tier;
      if (tagProtected) protectedIds.add(snapshotId);
      const createdAtMs = parseCreatedAtMs(entry.createdAt);
      const youngerThanCutoff = maxAgeCutoffMs == null || createdAtMs >= maxAgeCutoffMs;

      let action = 'keep';
      let reason = 'cache_budget';
      if (tagProtected) {
        reason = 'tag_pattern';
      } else if (policy.protectionReason) {
        reason = policy.protectionReason;
      } else if (retentionTier === 'forensic') {
        const withinKeep = keptFrozen < keepFrozenCount;
        if (withinKeep || youngerThanCutoff) {
          keptFrozen += 1;
          reason = withinKeep ? 'forensic_budget' : 'max_age';
        } else {
          action = 'remove';
          reason = 'age_and_forensic_budget';
        }
      } else {
        const withinKeep = keptPointer < keepPointerCount;
        if (withinKeep || youngerThanCutoff) {
          keptPointer += 1;
          reason = withinKeep ? 'pointer_budget' : 'max_age';
        } else {
          action = 'remove';
          reason = 'age_and_pointer_budget';
        }
      }

      decisions.push({
        snapshotId,
        retentionTier,
        action,
        reason
      });
      if (action === 'remove') {
        removedEntries.push(entry);
      }
    }

    removedEntries.sort((left, right) => {
      const leftMs = parseCreatedAtMs(left.createdAt);
      const rightMs = parseCreatedAtMs(right.createdAt);
      if (leftMs !== rightMs) return leftMs - rightMs;
      return String(left.snapshotId).localeCompare(String(right.snapshotId));
    });

    const removed = removedEntries.map((entry) => entry.snapshotId);
    if (!dryRunEnabled && removed.length) {
      for (const snapshotId of removed) {
        await fsPromises.rm(resolveSnapshotDir(repoCacheRoot, snapshotId), {
          recursive: true,
          force: true
        });
        delete manifest.snapshots[snapshotId];
      }
      manifest.updatedAt = new Date().toISOString();
      await writeSnapshotsManifest(repoCacheRoot, manifest, { lock });
    }

    return {
      dryRun: dryRunEnabled,
      removed,
      decisions: decisions.sort((left, right) => (
        String(left.snapshotId).localeCompare(String(right.snapshotId))
      )),
      protectedByTag: Array.from(protectedIds).sort((a, b) => a.localeCompare(b)),
      staleStaging: staleCleanup
    };
  });
};

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { acquireIndexLock } from '../build/lock.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { fromPosix, isAbsolutePathAny, toPosix } from '../../shared/files.js';
import { getRepoCacheRoot } from '../../shared/dict-utils.js';
import { isManifestPathSafe } from '../validate/paths.js';
import { validateArtifact } from '../../contracts/validators/artifacts.js';
import {
  cleanupStaleFrozenStagingDirs,
  loadFrozen,
  loadSnapshot,
  loadSnapshotsManifest,
  writeFrozen,
  writeSnapshotsManifest
} from './registry.js';
import { copySnapshotModeArtifacts } from './copy-pieces.js';

const SNAPSHOT_ID_RE = /^snap-[A-Za-z0-9._-]+$/;
const VALID_MODES = ['code', 'prose', 'extracted-prose', 'records'];
const DEFAULT_KEEP_POINTER = 50;
const DEFAULT_KEEP_FROZEN = 20;
const DEFAULT_KEEP_TAGS = ['release/*', 'release'];

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const invalidRequest = (message, details = null) => createError(ERROR_CODES.INVALID_REQUEST, message, details);
const notFound = (message, details = null) => createError(ERROR_CODES.NOT_FOUND, message, details);
const queueError = (message, details = null) => createError(ERROR_CODES.QUEUE_OVERLOADED, message, details);

const ensureSnapshotId = (snapshotId) => {
  if (typeof snapshotId !== 'string' || !SNAPSHOT_ID_RE.test(snapshotId)) {
    throw invalidRequest(`Invalid snapshot id "${snapshotId}".`);
  }
};

const normalizeMethod = (method) => {
  const normalized = String(method || 'hardlink').trim().toLowerCase();
  if (normalized === 'copy' || normalized === 'hardlink') return normalized;
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
  const resolved = path.resolve(repoCacheRoot, fromPosix(normalized));
  const cacheRootResolved = path.resolve(repoCacheRoot);
  const within = process.platform === 'win32'
    ? (
      resolved.toLowerCase() === cacheRootResolved.toLowerCase()
      || resolved.toLowerCase().startsWith(`${cacheRootResolved.toLowerCase()}${path.sep}`)
    )
    : (resolved === cacheRootResolved || resolved.startsWith(`${cacheRootResolved}${path.sep}`));
  if (!within) {
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
  const lock = await acquireIndexLock({
    repoCacheRoot,
    waitMs: Number.isFinite(options?.waitMs) ? Number(options.waitMs) : 0,
    pollMs: Number.isFinite(options?.pollMs) ? Number(options.pollMs) : 1000,
    staleMs: Number.isFinite(options?.staleMs) ? Number(options.staleMs) : undefined,
    log: typeof options?.log === 'function' ? options.log : () => {}
  });
  if (!lock) {
    throw queueError('Index lock held; unable to freeze snapshots.');
  }
  try {
    return await worker(lock);
  } finally {
    await lock.release();
  }
};

const linkOrCopyFile = async (srcPath, destPath, method) => {
  if (method === 'copy') {
    await fsPromises.copyFile(srcPath, destPath);
    return 'copy';
  }
  try {
    await fsPromises.link(srcPath, destPath);
    return 'hardlink';
  } catch (err) {
    if (!['EXDEV', 'EPERM', 'EACCES', 'EEXIST'].includes(err?.code)) {
      throw err;
    }
    await fsPromises.copyFile(srcPath, destPath);
    return 'copy';
  }
};

const copyOptionalDir = async ({
  sourceDir,
  targetDir,
  method
}) => {
  const copiedFiles = [];
  const walk = async (srcDir, dstDir) => {
    await fsPromises.mkdir(dstDir, { recursive: true });
    const entries = await fsPromises.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const dstPath = path.join(dstDir, entry.name);
      if (entry.isDirectory()) {
        await walk(srcPath, dstPath);
        continue;
      }
      await fsPromises.mkdir(path.dirname(dstPath), { recursive: true });
      const copyMethod = await linkOrCopyFile(srcPath, dstPath, method);
      const stat = await fsPromises.stat(dstPath);
      copiedFiles.push({
        sourcePath: srcPath,
        targetPath: dstPath,
        method: copyMethod,
        bytes: Number(stat.size || 0)
      });
    }
  };
  await walk(sourceDir, targetDir);
  return copiedFiles;
};

const hasSqliteArtifact = async (sqliteDir) => {
  if (!fs.existsSync(sqliteDir)) return false;
  const entries = await fsPromises.readdir(sqliteDir, { withFileTypes: true });
  return entries.some((entry) => (
    entry.isFile()
    && (
      entry.name.endsWith('.db')
      || entry.name.endsWith('.sqlite')
      || entry.name.endsWith('.sqlite3')
    )
  ));
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
  method = 'hardlink',
  verify = true,
  includeSqlite = 'auto',
  includeLmdb = false,
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

  return withSnapshotLock(repoCacheRoot, { waitMs }, async (lock) => {
    await cleanupStaleFrozenStagingDirs(repoCacheRoot, {
      lock,
      maxAgeHours: stagingMaxAgeHours
    });
    const manifest = loadSnapshotsManifest(repoCacheRoot);
    const entry = manifest.snapshots?.[snapshotId];
    if (!entry) {
      throw notFound(`Snapshot not found: ${snapshotId}`);
    }
    const snapshotJson = loadSnapshot(repoCacheRoot, snapshotId);
    if (!snapshotJson) {
      throw notFound(`snapshot.json missing for ${snapshotId}`);
    }
    const snapshotDir = path.join(repoCacheRoot, 'snapshots', snapshotId);
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
      for (const mode of selectedModes) {
        const sourceRoot = sourceRootByMode[mode];
        const copyResult = await copySnapshotModeArtifacts({
          sourceIndexDir: path.join(sourceRoot, `index-${mode}`),
          targetIndexDir: path.join(stagingDir, `index-${mode}`),
          method: normalizedMethod,
          verify: verifyEnabled
        });
        modeResults.push({ mode, result: copyResult });
      }

      const dominantSourceRoot = sourceRootByMode.code || sourceRootByMode[selectedModes[0]];
      const sourceSqliteDir = dominantSourceRoot ? path.join(dominantSourceRoot, 'index-sqlite') : null;
      const includeSqliteResolved = includeSqliteMode === 'auto'
        ? await hasSqliteArtifact(sourceSqliteDir)
        : includeSqliteMode === true;
      const includeLmdbResolved = includeLmdbEnabled === true;
      const optionalCopies = [];
      if (includeSqliteResolved) {
        if (!sourceSqliteDir || !fs.existsSync(sourceSqliteDir)) {
          throw notFound(`index-sqlite source missing for snapshot ${snapshotId}.`);
        }
        const copied = await copyOptionalDir({
          sourceDir: sourceSqliteDir,
          targetDir: path.join(stagingDir, 'index-sqlite'),
          method: normalizedMethod
        });
        optionalCopies.push(...copied);
      }

      if (includeLmdbResolved) {
        const sourceLmdbDir = dominantSourceRoot ? path.join(dominantSourceRoot, 'index-lmdb') : null;
        if (!sourceLmdbDir || !fs.existsSync(sourceLmdbDir)) {
          throw notFound(`index-lmdb source missing for snapshot ${snapshotId}.`);
        }
        const copied = await copyOptionalDir({
          sourceDir: sourceLmdbDir,
          targetDir: path.join(stagingDir, 'index-lmdb'),
          method: normalizedMethod
        });
        optionalCopies.push(...copied);
      }

      const sourceBuildStatePath = dominantSourceRoot
        ? path.join(dominantSourceRoot, 'build_state.json')
        : null;
      if (sourceBuildStatePath && fs.existsSync(sourceBuildStatePath)) {
        await linkOrCopyFile(sourceBuildStatePath, path.join(stagingDir, 'build_state.json'), normalizedMethod);
      }

      if (fs.existsSync(frozenDir)) {
        await fsPromises.rm(frozenDir, { recursive: true, force: true });
      }
      await fsPromises.rename(stagingDir, frozenDir);

      const checkedAt = new Date().toISOString();
      const filesChecked = modeResults.reduce((sum, entry) => sum + Number(entry.result.filesChecked || 0), 0);
      const bytesChecked = modeResults.reduce((sum, entry) => sum + Number(entry.result.bytesChecked || 0), 0);
      const filesCopied = modeResults.reduce((sum, entry) => sum + Number(entry.result.filesCopied || 0), 0)
        + optionalCopies.length;
      const bytesCopied = modeResults.reduce((sum, entry) => sum + Number(entry.result.bytesCopied || 0), 0)
        + optionalCopies.reduce((sum, entry) => sum + Number(entry.bytes || 0), 0);

      const frozenJson = {
        version: 1,
        snapshotId,
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
          ok: true,
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
        hasFrozen: true
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
        verificationOk: true
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

  return withSnapshotLock(repoCacheRoot, { waitMs }, async (lock) => {
    const staleCleanup = await cleanupStaleFrozenStagingDirs(repoCacheRoot, {
      lock,
      maxAgeHours: stagingMaxAgeHours
    });
    const manifest = loadSnapshotsManifest(repoCacheRoot);
    const entries = sortedSnapshotEntries(manifest);
    const protectedIds = new Set();
    for (const entry of entries) {
      const tags = Array.isArray(entry.tags) ? entry.tags : [];
      if (tags.some((tag) => keepTagPatterns.some((pattern) => matchesTagPattern(tag, pattern)))) {
        protectedIds.add(entry.snapshotId);
      }
    }

    const frozenEntries = entries.filter((entry) => entry.hasFrozen === true && !protectedIds.has(entry.snapshotId));
    const pointerEntries = entries.filter((entry) => entry.hasFrozen !== true && !protectedIds.has(entry.snapshotId));
    const removals = [];
    const chooseRemovals = (list, keepCount) => {
      for (let i = 0; i < list.length; i += 1) {
        const entry = list[i];
        const createdAtMs = parseCreatedAtMs(entry.createdAt);
        const withinKeep = i < keepCount;
        const youngerThanCutoff = maxAgeCutoffMs == null || createdAtMs >= maxAgeCutoffMs;
        const keepEntry = maxAgeCutoffMs == null
          ? withinKeep
          : (withinKeep || youngerThanCutoff);
        if (!keepEntry) removals.push(entry);
      }
    };
    chooseRemovals(frozenEntries, keepFrozenCount);
    chooseRemovals(pointerEntries, keepPointerCount);
    removals.sort((left, right) => {
      const leftMs = parseCreatedAtMs(left.createdAt);
      const rightMs = parseCreatedAtMs(right.createdAt);
      if (leftMs !== rightMs) return leftMs - rightMs;
      return String(left.snapshotId).localeCompare(String(right.snapshotId));
    });

    const removed = removals.map((entry) => entry.snapshotId);
    if (!dryRunEnabled && removed.length) {
      for (const snapshotId of removed) {
        await fsPromises.rm(path.join(repoCacheRoot, 'snapshots', snapshotId), {
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
      protectedByTag: Array.from(protectedIds).sort((a, b) => a.localeCompare(b)),
      staleStaging: staleCleanup
    };
  });
};

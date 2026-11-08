import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getApplicationHome, getCacheRoot } from '../../shared/cache-roots.js';
import { resolveRepoCacheRootPath } from '../../shared/repo-paths.js';
import { assertNoSymlinkPath } from '../../shared/contained-file.js';
import { stableStringify } from '../../shared/stable-json.js';
import { resolveConfiguredNativeStorageSelection } from '../../shared/storage/configured-native-storage.js';
import { readNativePublicationRecord, withNativePublicationLock, writeNativePublicationRecord,
  nativePublicationRegistryPaths, inspectNativePublicationHome } from '../../shared/storage/native-publication.js';
import { inspectNativePublicationFiles, sameNativePublicationFiles, nativePublicationFilePath } from '../../shared/storage/native-publication-files.js';
import { storageFileIdentity, sameStorageFileIdentity } from '../../shared/storage/inventory.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../shared/storage/access.js';
import { withStorageDirectory } from '../../shared/storage/directory.js';
import { describeStorageFailure, observeStorageResource } from '../../shared/storage/failure-observation.js';
import { readCurrentBuildReferences } from '../../shared/indexing/build-pointer-references.js';
import { withWatchRetentionExclusion } from './watch/retention.js';
import { readStorageLocator } from '../../shared/storage/locator-read.js';
import { removeToolingCacheEntry } from '../tooling/cache-storage.js';
import { isPathWithinRoot } from '../../shared/file-paths.js';

const require = createRequire(import.meta.url);
const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const retained = (target, reason, details = {}) => ({ status: 'retained-protected', root: target, removed: false, reason, ...details });
const saved = ['snapshots', 'diffs', 'triage', 'pins', '.pins', 'recovery', 'reports', 'recordings', 'history', 'state'];
const missing = (error, phase) => {
  observeStorageResource(error, { phase }).requireSettled();
  return describeStorageFailure(error, { phase }).code === 'ENOENT';
};
const exists = async target => {
  assertNoSymlinkPath(path.parse(target).root, target, { allowMissing: true });
  try { await fs.lstat(target); return true; }
  catch (error) { if (missing(error, 'native-cleanup-reference')) return false; throw error; }
};
const hasEntries = async target => {
  if (!await exists(target)) return false;
  return withStorageDirectory(target, async directory => Boolean(await directory.read()));
};

const proveOrphan = async ({ record, repoRoot, repoCacheRoot, buildsRoot, home, readReferences }) => {
  if (!record.qualified || !['ready', 'deleting', 'removed'].includes(record.state)) return 'native-publication-unqualified';
  if (record.sources.some(source => normalize(source.repoRoot) !== normalize(repoRoot)
    || normalize(source.repoCacheRoot) !== normalize(repoCacheRoot))) return 'shared-native-publication';
  for (const source of record.sources) if (await exists(source.indexDir)) return 'native-source-generation-retained';
  const references = await readReferences();
  if (references.roots.length) return 'published-generation-retained';
  for (const name of saved) if (await exists(path.join(repoCacheRoot, name))) return 'saved-or-unknown-repository-evidence';
  for (const target of [path.join(home, 'reports'), path.join(home, 'recovery'),
    path.join(home, 'state', 'repos', path.basename(repoCacheRoot))]) {
    if (await hasEntries(target)) return 'saved-or-unknown-application-evidence';
  }
  // Keep the canonical reference namespace bound even when no current pointer
  // exists. Its index lock is held by the actual mutation owner below.
  if (normalize(buildsRoot) !== normalize(path.join(repoCacheRoot, 'builds'))) throw new Error('Native cleanup builds selection changed.');
  return null;
};

/** Bounded real metadata operations through the existing native command owner.
 * No nested reader lease is admitted inside our own exclusive namespace. */
const requalifyNative = async record => {
  const { runNativeDatabaseCommand } = await import('../../shared/storage/native-database-lifetime.js');
  await runNativeDatabaseCommand({ commandIdentity: `${record.backend}.cleanup.inspect` }, async resources => {
    if (record.backend === 'sqlite') {
      const Database = require('better-sqlite3');
      const { assertSqliteIndexFormat } = await import('../../storage/sqlite/index-format.js');
      const { SCHEMA_VERSION } = await import('../../storage/sqlite/schema.js');
      if (record.sourceWitness?.schemaVersion !== SCHEMA_VERSION) throw new Error('Native SQLite publication schema is obsolete.');
      const db = resources.open(() => new Database(record.target, { readonly: true, fileMustExist: true, timeout: 1000 }));
      await resources.use(db, () => assertSqliteIndexFormat({ db, repoRoot: record.sources[0].repoRoot, indexPath: record.target }));
    } else {
      const { open } = require('lmdb');
      const { Unpackr } = await import('msgpackr');
      const { LMDB_SCHEMA_VERSION, LMDB_META_KEYS } = await import('../../storage/lmdb/schema.js');
      const unpackr = new Unpackr();
      if (record.sourceWitness?.schemaVersion !== LMDB_SCHEMA_VERSION) throw new Error('Native LMDB publication schema is obsolete.');
      const db = resources.open(() => open({ path: record.target, readOnly: true }));
      await resources.use(db, () => {
        const decode = key => { const value = db.get(key); return value == null ? null : unpackr.unpack(value); };
        if (decode(LMDB_META_KEYS.schemaVersion) !== LMDB_SCHEMA_VERSION || decode(LMDB_META_KEYS.mode) !== record.mode
          || normalize(decode(LMDB_META_KEYS.sourceIndex) || '') !== normalize(record.sourceWitness.indexDir)) {
          throw new Error('Native LMDB metadata does not match its actual publication.');
        }
      });
    }
  });
};

const remainingMatches = (record, family) => {
  if (!family.complete) return false;
  if (record.backend === 'lmdb' && family.root && (!record.family.root
    || family.root.dev !== record.family.root.dev || family.root.ino !== record.family.root.ino)) return false;
  const remaining = new Set(record.deletion.remaining);
  return family.files.every(file => remaining.has(file.name)
    && sameStorageFileIdentity(file.identity, record.family.files.find(expected => expected.name === file.name)?.identity));
};

const removeQualifiedNative = async ({ record, paths, recheck }) => {
  let active = record, logicalBytesRemoved = 0;
  let family = await inspectNativePublicationFiles(record.backend, record.target);
  if (record.state === 'ready') {
    if (!sameNativePublicationFiles(record.backend, record.family, family, { allowLmdbReaderLock: true })) {
      return retained(record.target, 'native-family-changed-since-publication');
    }
    await requalifyNative(record);
    const closedFamily = await inspectNativePublicationFiles(record.backend, record.target);
    if (!sameNativePublicationFiles(record.backend, family, closedFamily, { allowLmdbReaderLock: true })) {
      return retained(record.target, 'native-family-changed-during-inspection');
    }
    const changed = await recheck(record);
    if (changed) return retained(record.target, changed);
    family = closedFamily;
    active = { ...record, state: 'deleting', family, deletion: { remaining: family.files.map(file => file.name) } };
    await writeNativePublicationRecord(paths, active);
  } else if (record.state === 'removed') {
    return family.missing ? { status: 'missing', root: record.target, removed: false }
      : retained(record.target, 'removed-native-target-reappeared');
  }
  if (!remainingMatches(active, family)) return retained(record.target, 'native-deletion-members-changed');
  for (const name of [...active.deletion.remaining]) {
    const reason = await recheck(active);
    if (reason) return retained(record.target, reason, { logicalBytesRemoved });
    const file = nativePublicationFilePath(active.backend, active.target, name);
    const expected = active.family.files.find(member => member.name === name);
    try {
      assertNoSymlinkPath(path.parse(file).root, file);
      const stat = fsSync.lstatSync(file, { bigint: true });
      if (!sameStorageFileIdentity(storageFileIdentity(stat), expected.identity) || !removeToolingCacheEntry(file, stat)) {
        return retained(record.target, 'native-member-changed-before-unlink', { logicalBytesRemoved });
      }
      logicalBytesRemoved += Number(stat.size);
    } catch (error) {
      // Only a committed deletion journal can reconcile an already absent
      // member. Its bytes are unknown, never counted as reclaimed by this run.
      if (!missing(error, 'native-cleanup-unlink')) throw error;
    }
    active = { ...active, deletion: { remaining: active.deletion.remaining.filter(member => member !== name) } };
    await writeNativePublicationRecord(paths, active);
  }
  const finalFamily = await inspectNativePublicationFiles(active.backend, active.target);
  if (!finalFamily.complete || finalFamily.files.length) return retained(record.target, 'native-members-appeared-during-removal', { logicalBytesRemoved });
  if (active.backend === 'lmdb' && finalFamily.root) {
    if (finalFamily.root.dev !== active.family.root.dev || finalFamily.root.ino !== active.family.root.ino) {
      return retained(record.target, 'native-directory-replaced', { logicalBytesRemoved });
    }
    const reason = await recheck(active);
    if (reason) return retained(record.target, reason, { logicalBytesRemoved });
    assertNoSymlinkPath(path.parse(active.target).root, active.target);
    const directory = fsSync.lstatSync(active.target, { bigint: true });
    if (!directory.isDirectory() || String(directory.dev) !== active.family.root.dev || String(directory.ino) !== active.family.root.ino) {
      return retained(record.target, 'native-directory-replaced-before-rmdir', { logicalBytesRemoved });
    }
    fsSync.rmdirSync(active.target);
  }
  await writeNativePublicationRecord(paths, { ...active, state: 'removed' });
  return { status: 'removed', root: active.target, removed: true, logicalBytesRemoved, physicalBytesReclaimed: null };
};

export const cleanupConfiguredNativeArtifact = async ({ repoRoot, userConfig, backend, mode, target, dryRun = false }) => {
  const context = { repoRoot, userConfig, nativeBackend: backend, nativeMode: mode };
  const selection = resolveConfiguredNativeStorageSelection(target, context);
  if (!selection) return retained(target, 'backend-category-cleanup-unqualified');
  const home = getApplicationHome(), cacheRoot = userConfig.cache?.root || getCacheRoot();
  const locator = readStorageLocator(home);
  const repoCacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig), buildsRoot = path.join(repoCacheRoot, 'builds');
  if (isPathWithinRoot(target, repoCacheRoot)) return retained(target, 'canonical-native-category-owner-required');
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  const sharedCoordination = nativePublicationRegistryPaths(target, { home }).access;
  const revalidate = () => {
    const currentLocator = readStorageLocator(home);
    if (normalize(getApplicationHome()) !== normalize(home)
      || locator.status === 'invalid' || currentLocator.status !== locator.status || currentLocator.sha256 !== locator.sha256
      || stableStringify(resolveConfiguredNativeStorageSelection(target, context)) !== stableStringify(selection)) {
      throw new Error('Native cleanup launch selection changed.');
    }
  };
  try {
    revalidate();
    const publication = await readNativePublicationRecord(target, { home });
    if (!publication) return await exists(target) ? retained(target, 'backend-category-cleanup-unqualified')
      : { status: 'missing', root: target, removed: false };
    if (publication.record.backend !== backend || publication.record.mode !== mode) return retained(target, 'native-publication-selection-mismatch');
    const proofInput = { repoRoot, repoCacheRoot, buildsRoot, home };
    const recheck = async record => {
      revalidate();
      const current = await readNativePublicationRecord(target, { home });
      if (!current || stableStringify(current.record) !== stableStringify(record)) return 'native-publication-changed-during-cleanup';
      const sharedHome = await inspectNativePublicationHome(target, home, record);
      if (sharedHome) return sharedHome;
      return proveOrphan({ ...proofInput, record, readReferences: () => readCurrentBuildReferences({ repoRoot, repoCacheRoot, buildsRoot }) });
    };
    for (const [root, options] of [[repoCacheRoot, {}], [repoCacheRoot, { coordinationRoot }], [selection.namespace, { coordinationRoot }],
      [selection.namespace, { coordinationRoot: sharedCoordination }]]) {
      const access = await inspectStorageAccess(root, options);
      if (access.protected) return retained(target, 'active-or-unknown-native-owner', { access });
    }
    const reason = await recheck(publication.record);
    if (reason) return retained(target, reason);
    if (dryRun) {
      const family = await inspectNativePublicationFiles(backend, target);
      if (publication.record.state === 'removed') return family.missing
        ? { status: 'missing', root: target, removed: false } : retained(target, 'removed-native-target-reappeared');
      const matches = publication.record.state === 'deleting' ? remainingMatches(publication.record, family)
        : sameNativePublicationFiles(backend, publication.record.family, family, { allowLmdbReaderLock: true });
      return matches ? { status: 'planned', root: target, removed: false, nativeRequalification: 'required-on-apply' }
        : retained(target, 'native-family-changed-since-publication');
    }
    return await withWatchRetentionExclusion({ repoRoot, userConfig, repoCacheRoot, buildsRoot, home, cacheRoot,
      action: async () => {
        const exclusive = await withExclusiveStorageAccess(selection.namespace, async () => {
          const shared = await withExclusiveStorageAccess(selection.namespace, () => withNativePublicationLock(target, { home }, async paths => {
            const current = await readNativePublicationRecord(target, { home });
            if (!current || current.sha256 !== publication.sha256) return retained(target, 'native-publication-changed-after-planning');
            const blocked = await recheck(current.record);
            if (blocked) return retained(target, blocked);
            return removeQualifiedNative({ record: current.record, paths, recheck });
          }), { coordinationRoot: sharedCoordination });
          return shared.protected ? retained(target, shared.reason, { owners: shared.owners }) : shared.result;
        }, { coordinationRoot });
        return exclusive.protected ? retained(target, exclusive.reason, { owners: exclusive.owners }) : exclusive.result;
      } });
  } catch (error) {
    observeStorageResource(error, { phase: 'native-cleanup-original-failure' }).requireSettled();
    return retained(target, 'native-cleanup-failed', { logicalBytesRemoved: null, physicalBytesReclaimed: null, removalMayBePartial: true,
      error: describeStorageFailure(error, { phase: 'native-cleanup' }) });
  }
};

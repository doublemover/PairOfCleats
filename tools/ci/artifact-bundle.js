import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile } from '../../src/shared/artifact-io/json.js';
import { randomUUID } from 'node:crypto';
import { getBuildsRoot, getRepoCacheRoot, getIndexDir } from '../shared/dict-utils.js';
import { sha256File } from '../../src/shared/hash.js';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';
import { replaceDir } from '../../src/shared/io/replace-dir.js';
import { resolveArtifactPath } from '../../src/shared/artifact-io/contained-path.js';
import { toRealPathSync, isWithinRoot } from '../../src/workspace/identity.js';
import { retainRepoCacheAccess } from '../../src/shared/cache/repo-access.js';
import { acquireIndexLock } from '../../src/index/build/lock.js';
import { promoteBuild } from '../../src/index/build/promotion.js';
import { validateIndexArtifacts } from '../../src/index/validate.js';
import { assertArtifactPublicationReady, readArtifactPublicationRecord,
  validateArtifactPublicationGeneration, writeArtifactPublicationRecord
} from '../../src/index/build/artifact-publication.js';
import { syncParentDirectory } from '../../src/shared/io/persistence-helpers.js';
import { resolveSqliteZeroStateSourceProof, sqliteZeroStateChecksum, SQLITE_ZERO_STATE_SCHEMA_VERSION } from '../../src/storage/sqlite/zero-state.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';

export const CI_BUNDLE_VERSION = 4;
const MODES = ['code', 'prose'];
const readJson = async file => readJsonFile(file, { maxBytes: 16 * 1024 * 1024 });

export const assertDisjointCiPaths = (left, right) => {
  const a = toRealPathSync(path.resolve(left));
  const b = toRealPathSync(path.resolve(right));
  if (isWithinRoot(a, b) || isWithinRoot(b, a)) {
    throw new Error(`CI artifact paths overlap: ${left} and ${right}`);
  }
};

// An inventory is complete: no omitted, linked, special, duplicate or extra file
// may acquire authority just because a copied manifest happens to mention it.
export const inventoryCiFiles = async root => {
  const files = {};
  const visit = async directory => {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe CI directory: ${directory}`);
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const label = path.relative(root, file).replaceAll('\\', '/');
      if (label === 'manifest.json') continue;
      const selected = await fs.lstat(file);
      if (selected.isSymbolicLink()) throw new Error(`CI artifacts cannot contain links: ${label}`);
      if (selected.isDirectory()) await visit(file);
      else if (selected.isFile()) {
        resolveArtifactPath(root, label);
        Object.defineProperty(files, label, { value: { bytes: selected.size,
          sha256: await sha256File(file, { containedRoot: root }) }, enumerable: true });
      } else throw new Error(`Unsupported CI artifact: ${label}`);
    }
  };
  await visit(root);
  return files;
};

export const verifyCiBundleInventory = async (root, manifest) => {
  if (manifest?.version !== CI_BUNDLE_VERSION || manifest.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION
    || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('CI artifact bundle identity is unsupported; export a fresh version 4 bundle.');
  }
  const actual = await inventoryCiFiles(root);
  const expected = Object.keys(manifest.files);
  if (expected.length !== Object.keys(actual).length) throw new Error('CI bundle inventory is incomplete.');
  for (const label of expected) {
    resolveArtifactPath(root, label);
    const receipt = manifest.files[label];
    if (!Object.hasOwn(actual, label) || !/^[a-f0-9]{64}$/.test(receipt?.sha256 || '')
      || !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 0
      || receipt.sha256 !== actual[label].sha256 || receipt.bytes !== actual[label].bytes) {
      throw new Error(`CI artifact checksum or size mismatch: ${label}`);
    }
  }
};

const syncCopiedTree = async root => {
  const inventory = await inventoryCiFiles(root);
  for (const label of Object.keys(inventory)) {
    const file = resolveArtifactPath(root, label);
    const handle = await fs.open(file, 'r+');
    let failure = null;
    try { await handle.sync(); } catch (error) { failure = error; throw error; }
    finally { try { await handle.close(); } catch (error) { if (failure) failure.cleanupError = error; else throw error; } }
    await syncParentDirectory(file);
  }
  await syncParentDirectory(root);
};

const rebindZeroState = async ({ outDir, buildRoot, mode, authority }) => {
  const markerPath = path.join(outDir, 'pieces', 'sqlite-zero-state.json');
  let marker;
  try { marker = await readJson(markerPath); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const { checksum, ...body } = marker;
  const oldIndexDir = authority.publication.indexDir;
  const oldOutput = authority.sourceSqlitePath;
  if (body.schemaVersion !== SQLITE_ZERO_STATE_SCHEMA_VERSION || body.mode !== mode
    || body.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION || body.chunkCount !== 0 || body.denseCount !== 0
    || body.indexDir !== oldIndexDir || body.outputPath !== oldOutput || checksum !== sqliteZeroStateChecksum(body)
    || body.sourceProof !== await resolveSqliteZeroStateSourceProof(outDir, mode, { identityIndexDir: oldIndexDir })) {
    throw new Error(`CI ${mode} zero-state source authority is invalid.`);
  }
  body.indexDir = path.resolve(outDir);
  body.outputPath = path.join(buildRoot, 'index-sqlite', `index-${mode}.db`);
  body.sourceProof = await resolveSqliteZeroStateSourceProof(outDir, mode);
  await atomicWriteJson(markerPath, { ...body, checksum: sqliteZeroStateChecksum(body) }, { spaces: 2, newline: true });
  const manifestPath = path.join(outDir, 'pieces', 'manifest.json');
  const manifest = await readJson(manifestPath);
  for (const piece of manifest.pieces || []) {
    if (piece.path !== 'pieces/sqlite-zero-state.json') continue;
    piece.checksum = `sha256:${await sha256File(markerPath, { containedRoot: outDir })}`;
    piece.bytes = (await fs.stat(markerPath)).size;
  }
  await atomicWriteJson(manifestPath, manifest, { spaces: 2, newline: true });
};

const withIndexAuthority = async ({ root, userConfig }, action) => {
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  retainRepoCacheAccess(repoCacheRoot);
  const lock = await acquireIndexLock({ repoCacheRoot, storageContext: { repoRoot: root, userConfig },
    metadata: { operation: 'ci-artifacts' } });
  if (!lock) throw new Error('Repository index writer is active; retry CI artifact transfer after it finishes.');
  let error = null;
  try { return await action(); }
  catch (cause) { error = cause; throw cause; }
  finally {
    try { await lock.release(); }
    catch (cleanupError) { if (error) error.cleanupError = cleanupError; else throw cleanupError; }
  }
};

const validateMode = async ({ root, userConfig, buildRoot, mode, sqlite }) => {
  // Explicit backend paths must never redirect validation out of the staged generation.
  const stagedConfig = { ...userConfig, sqlite: { ...userConfig.sqlite, dbDir: null,
    codeDbPath: null, proseDbPath: null, extractedProseDbPath: null, recordsDbPath: null } };
  const report = await validateIndexArtifacts({ root, userConfig: stagedConfig,
    indexRoot: buildRoot, modes: [mode], strict: true, sqliteEnabled: sqlite, lmdbEnabled: false });
  if (!report.ok) throw new Error(`CI ${mode} validation failed: ${report.issues.join('; ')}`);
};

/** Resolve selected roots only after child builds, then hold writer exclusion and the
 * existing cache lease until the validated export has replaced its destination. */
export const exportCiArtifactBundle = async ({ root, userConfig, outDir, gitState, includeSqlite = true }) => {
  assertDisjointCiPaths(outDir, getRepoCacheRoot(root, userConfig));
  // An output ancestor of the repository could otherwise replace source authority.
  if (isWithinRoot(toRealPathSync(root), toRealPathSync(outDir))) throw new Error('CI output contains the repository.');
  return withIndexAuthority({ root, userConfig }, async () => {
    const sources = new Map(MODES.map(mode => [mode, getIndexDir(root, mode, userConfig)]));
    for (const source of sources.values()) assertDisjointCiPaths(outDir, source);
    const staged = `${path.resolve(outDir)}.staged-${randomUUID()}`;
    await fs.mkdir(path.dirname(staged), { recursive: true });
    await fs.mkdir(staged, { recursive: false });
    try {
      const modes = {};
      for (const [mode, source] of sources) {
        const buildRoot = path.dirname(source);
        await assertArtifactPublicationReady({ buildRoot, modes: [mode] });
        const publication = await readArtifactPublicationRecord(buildRoot, mode);
        await validateMode({ root, userConfig, buildRoot, mode, sqlite: includeSqlite });
        const state = await readJson(path.join(buildRoot, 'build_state.json'));
        const sourceCommit = state?.repo?.head?.commitId || (typeof state?.repo?.head === 'string' ? state.repo.head : null)
          || state?.repo?.commit || null;
        if (sourceCommit && gitState.head && sourceCommit !== gitState.head) {
          throw new Error(`Selected ${mode} generation belongs to another commit; rebuild before exporting.`);
        }
        await inventoryCiFiles(source); // Refuse links before recursive copy.
        await fs.cp(source, path.join(staged, `index-${mode}`), { recursive: true, errorOnExist: true, force: false });
        let hasSqlite = false;
        if (includeSqlite) {
          const database = path.join(buildRoot, 'index-sqlite', `index-${mode}.db`);
          // Do not export a database from an override or another selected mode root.
          try {
            const wal = await fs.stat(`${database}-wal`);
            if (wal.size) throw new Error(`SQLite WAL is not checkpointed for ${mode}; finish stage 4 before export.`);
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
          try {
            const databaseStat = await fs.lstat(database);
            if (!databaseStat.isFile() || databaseStat.isSymbolicLink()) throw new Error(`Unsafe SQLite artifact for ${mode}.`);
            await fs.mkdir(path.join(staged, 'index-sqlite'), { recursive: true });
            await fs.copyFile(database, path.join(staged, 'index-sqlite', `index-${mode}.db`));
            hasSqlite = true;
          } catch (error) { if (error.code !== 'ENOENT') throw error; }

        }
        modes[mode] = { buildId: publication.buildId, compatibilityKey: publication.compatibilityKey,
          sourceBuildRoot: buildRoot, sourceCommit, sourceSqlitePath: path.join(buildRoot, 'index-sqlite', `index-${mode}.db`),
          publication, buildState: state, sqlite: hasSqlite, sqliteRequested: includeSqlite };
      }
      const manifest = { version: CI_BUNDLE_VERSION, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
        generatedAt: new Date().toISOString(),
        commit: MODES.every(mode => modes[mode].sourceCommit && modes[mode].sourceCommit === modes.code.sourceCommit) ? modes.code.sourceCommit : null,
        dirty: Object.fromEntries(MODES.map(mode => [mode, modes[mode].buildState?.repo?.dirty ?? null])),
        repo: { root: path.resolve(root) }, modes, files: await inventoryCiFiles(staged) };
      await atomicWriteJson(path.join(staged, 'manifest.json'), manifest, { spaces: 2, newline: true });
      await verifyCiBundleInventory(staged, manifest);
      await syncCopiedTree(staged);
      await replaceDir(staged, path.resolve(outDir));
      return manifest;
    } catch (error) {
      try { await fs.rm(staged, { recursive: true, force: true }); } catch (cleanupError) { error.cleanupError = cleanupError; }
      throw error;
    }
  });
};

/** Never write selected generation bytes. Every admitted mode gets a new immutable
 * root; the ordinary promotion owner commits all mode selections in one pointer. */
export const restoreCiArtifactBundle = async ({ root, userConfig, fromDir, gitState, force = false }) => {
  assertDisjointCiPaths(fromDir, getRepoCacheRoot(root, userConfig));
  const manifest = await readJson(resolveArtifactPath(fromDir, 'manifest.json'));
  await verifyCiBundleInventory(fromDir, manifest);
  if (!force && manifest.commit !== gitState.head) throw new Error('CI artifacts do not match the current commit (use --force to override commit policy).');
  if (!manifest.modes || Object.keys(manifest.modes).length !== MODES.length
    || MODES.some(mode => !Object.hasOwn(manifest.modes, mode))) throw new Error('CI bundle requires code and prose mode authority.');
  return withIndexAuthority({ root, userConfig }, async () => {
    const restoreRoot = path.join(getBuildsRoot(root, userConfig), `ci-restore-${randomUUID()}`);
    await fs.mkdir(path.dirname(restoreRoot), { recursive: true });
    await fs.mkdir(restoreRoot);
    try {
      const modeBuildRoots = {};
      for (const mode of MODES) {
        const authority = manifest.modes[mode];
        const prior = authority?.publication;
        if (!authority?.buildId || prior?.mode !== mode || prior.buildId !== authority.buildId
          || prior.status !== 'published' || prior.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION
          || prior.publicationValidation?.ok !== true || typeof authority.sqlite !== 'boolean') {
          throw new Error(`CI ${mode} generation authority is invalid.`);
        }
        const buildRoot = mode === 'code' ? restoreRoot : `${restoreRoot}-${mode}`;
        const outDir = path.join(buildRoot, `index-${mode}`);
        if (mode !== 'code') await fs.mkdir(buildRoot);
        await fs.cp(resolveArtifactPath(fromDir, `index-${mode}`), outDir, { recursive: true, force: false, errorOnExist: true });
        if (authority.sqlite) {
          await fs.mkdir(path.join(buildRoot, 'index-sqlite'));
          await fs.copyFile(resolveArtifactPath(fromDir, `index-sqlite/index-${mode}.db`), path.join(buildRoot, 'index-sqlite', `index-${mode}.db`));
        }
        const copiedFiles = await inventoryCiFiles(outDir);
        const prefix = `index-${mode}/`;
        const expectedFiles = Object.keys(manifest.files).filter(label => label.startsWith(prefix));
        if (expectedFiles.length !== Object.keys(copiedFiles).length) throw new Error(`CI ${mode} copied inventory differs.`);
        for (const label of expectedFiles) {
          const actual = copiedFiles[label.slice(prefix.length)];
          const expected = manifest.files[label];
          if (actual?.sha256 !== expected.sha256 || actual?.bytes !== expected.bytes) throw new Error(`CI copied artifact changed: ${label}`);
        }
        if (authority.sqlite) {
          const label = `index-sqlite/index-${mode}.db`;
          if (await sha256File(path.join(buildRoot, label), { containedRoot: buildRoot }) !== manifest.files[label]?.sha256) {
            throw new Error(`CI copied SQLite artifact changed: ${mode}`);
          }
        }
        if (!authority.sqlite) await rebindZeroState({ outDir, buildRoot, mode, authority });
        await syncCopiedTree(buildRoot);
        await atomicWriteJson(path.join(buildRoot, 'build_state.json'), authority.buildState, { spaces: 2, newline: true });
        const pieceManifest = await readJson(path.join(outDir, 'pieces', 'manifest.json'));
        if (pieceManifest.mode !== mode || pieceManifest.buildId !== authority.buildId
          || pieceManifest.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION
          || (pieceManifest.compatibilityKey || null) !== (authority.compatibilityKey || null)) {
          throw new Error(`CI ${mode} manifest identity conflicts with the bundle.`);
        }
        await validateMode({ root, userConfig, buildRoot, mode, sqlite: authority.sqliteRequested === true || authority.sqlite });
        const validation = await validateArtifactPublicationGeneration({ buildRoot, outDir, mode,
          buildId: authority.buildId, pieceEntries: pieceManifest.pieces });
        await writeArtifactPublicationRecord({ buildRoot, outDir, mode, buildId: authority.buildId,
          compatibilityKey: authority.compatibilityKey, stage: 'ci-restore', pieceEntries: pieceManifest.pieces,
          publicationValidation: validation, identityReconciliation: prior.identityReconciliation });
        modeBuildRoots[mode] = buildRoot;
      }
      // Re-read the external authority before the one irreversible selection change.
      await verifyCiBundleInventory(fromDir, manifest);
      const primary = manifest.modes.code;
      const result = await promoteBuild({ repoRoot: root, userConfig, buildId: primary.buildId,
        buildRoot: modeBuildRoots.code, modeBuildRoots, stage: 'ci-restore', modes: MODES,
        configHash: primary.buildState?.configHash, compatibilityKey: primary.compatibilityKey,
        repoProvenance: { ...(primary.buildState?.repo || {}), ciBundleCommit: manifest.commit } });
      return result;
    } catch (error) {
      // A failed promotion may have committed before a durability error was reported.
      // Retain staged generations for recovery rather than deleting pointer targets.
      error.recoveryPath = restoreRoot;
      throw error;
    }
  });
};

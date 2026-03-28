#!/usr/bin/env node
import { applyTestEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireIndexLock } from '../../src/index/build/lock.js';
import { getRepoCacheRoot } from '../../src/shared/dict-utils.js';
import {
  createPointerSnapshot,
  listSnapshots,
  pruneSnapshots,
  removeSnapshot,
  showSnapshot
} from '../../src/index/snapshots/create.js';
import { freezeSnapshot } from '../../src/index/snapshots/freeze.js';
import { resolveIndexRef } from '../../src/index/index-ref.js';
import { loadFrozen, loadSnapshot, loadSnapshotsManifest } from '../../src/index/snapshots/registry.js';
import { computeIndexDiff, pruneDiffs, showDiff } from '../../src/index/diffs/compute.js';
import { loadDiffsManifest, writeDiffsManifest } from '../../src/index/diffs/registry.js';
import { replaceDir } from '../../src/shared/json-stream/atomic.js';

import { createBaseIndex } from '../indexing/validate/helpers.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const writeBuildState = async ({
  repoCacheRoot,
  buildId,
  validationOk = true,
  includeValidation = true
}) => {
  const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
  const payload = {
    schemaVersion: 1,
    buildId,
    configHash: `cfg-${buildId}`,
    tool: { version: '1.0.0' },
    repo: { provider: 'git', branch: 'main', commit: 'abc123', dirty: false }
  };
  if (includeValidation) {
    payload.validation = { ok: validationOk, issueCount: 0, warningCount: 0, issues: [] };
  }
  await writeJson(path.join(buildRoot, 'build_state.json'), payload);
  return buildRoot;
};

const sha1File = async (filePath) => {
  const data = await fs.readFile(filePath);
  return crypto.createHash('sha1').update(data).digest('hex');
};

const enrichPiecesManifestChecksums = async (indexDir, { corruptFirst = false } = {}) => {
  const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const pieces = Array.isArray(manifest.pieces) ? manifest.pieces : [];
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i];
    const filePath = path.join(indexDir, piece.path);
    const stat = await fs.stat(filePath);
    piece.bytes = Number(stat.size || 0);
    const hash = await sha1File(filePath);
    piece.checksum = `sha1:${hash}`;
  }
  if (corruptFirst && pieces.length) {
    pieces[0].checksum = 'sha1:0000000000000000000000000000000000000000';
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
};

const seedFreezeBuildRoot = async ({
  repoCacheRoot,
  buildId,
  corruptManifest = false
}) => {
  const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
  await fs.mkdir(buildRoot, { recursive: true });
  const { indexDir } = await createBaseIndex({ rootDir: buildRoot });
  const modeDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(path.dirname(modeDir), { recursive: true });
  await replaceDir(indexDir, modeDir);
  await fs.rm(path.join(buildRoot, '.index-root'), { recursive: true, force: true });
  await enrichPiecesManifestChecksums(modeDir, { corruptFirst: corruptManifest });
  await writeJson(path.join(buildRoot, 'build_state.json'), {
    schemaVersion: 1,
    buildId,
    configHash: `cfg-${buildId}`,
    tool: { version: '1.0.0' },
    validation: { ok: true, issueCount: 0, warningCount: 0, issues: [] }
  });
  return buildRoot;
};

const sha1Value = (value) => crypto.createHash('sha1').update(String(value)).digest('hex');

const writePiecesManifest = async (indexDir, files) => {
  const entries = [];
  for (const file of files) {
    const absolute = path.join(indexDir, file.path);
    const stat = await fs.stat(absolute);
    entries.push({
      type: file.type,
      name: file.name,
      format: 'json',
      path: file.path,
      bytes: Number(stat.size || 0),
      checksum: `sha1:${await sha1File(absolute)}`
    });
  }
  await writeJson(path.join(indexDir, 'pieces', 'manifest.json'), {
    version: 2,
    artifactSurfaceVersion: '0.2.0',
    pieces: entries
  });
};

const seedDiffBuild = async ({
  repoCacheRoot,
  buildId,
  files,
  chunkSignature,
  configHash,
  toolVersion,
  fileMetaRows = null,
  chunkMetaRows = null
}) => {
  const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
  const indexDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(indexDir, { recursive: true });

  const fileMeta = Array.isArray(fileMetaRows) && fileMetaRows.length
    ? fileMetaRows
    : files.map((entry, index) => ({
      id: index + 1,
      file: entry.file,
      hash: sha1Value(entry.content),
      size: entry.content.length,
      ext: 'js'
    }));
  await writeJson(path.join(indexDir, 'file_meta.json'), fileMeta);

  const chunkMeta = Array.isArray(chunkMetaRows) && chunkMetaRows.length
    ? chunkMetaRows
    : files.map((entry, index) => ({
      id: index,
      fileId: index + 1,
      file: entry.file,
      start: 0,
      end: entry.content.length,
      startLine: 1,
      endLine: 1,
      kind: 'function',
      name: entry.file,
      chunkId: entry.chunkId,
      metaV2: {
        chunkId: entry.chunkId,
        chunkUid: `ck:${buildId}:${entry.chunkId}`,
        signature: chunkSignature[entry.file],
        virtualPath: entry.file,
        file: entry.file
      }
    }));
  await writeJson(path.join(indexDir, 'chunk_meta.json'), chunkMeta);

  await writeJson(path.join(indexDir, 'index_state.json'), {
    generatedAt: new Date().toISOString(),
    mode: 'code',
    artifactSurfaceVersion: '0.2.0',
    buildId,
    configHash,
    tool: { version: toolVersion }
  });

  await writePiecesManifest(indexDir, [
    { type: 'meta', name: 'file_meta', path: 'file_meta.json' },
    { type: 'chunks', name: 'chunk_meta', path: 'chunk_meta.json' },
    { type: 'stats', name: 'index_state', path: 'index_state.json' }
  ]);

  await writeJson(path.join(buildRoot, 'build_state.json'), {
    schemaVersion: 1,
    buildId,
    configHash,
    tool: { version: toolVersion },
    validation: { ok: true, issueCount: 0, warningCount: 0, issues: [] }
  });
  return buildRoot;
};

const runSnapshotCreateCase = async () => {
  applyTestEnv();

  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, 'snapshot-create-service');
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');
  const userConfig = { cache: { root: cacheRoot } };

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(repoRoot, { recursive: true });

  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  await fs.mkdir(buildsRoot, { recursive: true });

  const buildCodeRoot = await writeBuildState({
    repoCacheRoot,
    buildId: 'build-code',
    validationOk: true
  });
  const buildProseRoot = await writeBuildState({
    repoCacheRoot,
    buildId: 'build-prose',
    validationOk: true
  });
  await writeJson(path.join(buildsRoot, 'current.json'), {
    buildId: 'build-code',
    buildRoot: 'builds/build-code',
    buildRoots: {
      code: 'builds/build-code',
      prose: 'builds/build-prose'
    }
  });

  const firstSnapshot = await createPointerSnapshot({
    repoRoot,
    userConfig,
    modes: ['code'],
    tags: ['release'],
    snapshotId: 'snap-20260212000000-aa0001'
  });
  assert.equal(firstSnapshot.snapshotId, 'snap-20260212000000-aa0001');
  assert.deepEqual(firstSnapshot.modes, ['code']);
  assert.equal(firstSnapshot.retention?.tier, 'pinned');

  const manifestAfterFirst = loadSnapshotsManifest(repoCacheRoot);
  assert.ok(manifestAfterFirst.snapshots[firstSnapshot.snapshotId]);
  const firstSnapshotJson = loadSnapshot(repoCacheRoot, firstSnapshot.snapshotId);
  assert.deepEqual(Object.keys(firstSnapshotJson.pointer.buildRootsByMode), ['code']);
  assert.equal(firstSnapshotJson.pointer.buildRootsByMode.code, 'builds/build-code');

  const activeBuildLock = await acquireIndexLock({
    repoCacheRoot,
    waitMs: 0,
    metadata: {
      owner: 'build-index',
      operation: 'stage4-promote'
    }
  });
  assert.ok(activeBuildLock);
  try {
    const concurrentSnapshot = await createPointerSnapshot({
      repoRoot,
      userConfig,
      modes: ['code'],
      snapshotId: 'snap-20260212000000-aa0002',
      waitMs: 0
    });
    assert.equal(concurrentSnapshot.snapshotId, 'snap-20260212000000-aa0002');
  } finally {
    await activeBuildLock.release();
  }

  const escapeTargetRoot = path.join(tempRoot, 'snapshot-escape-target');
  const escapeLinkRoot = path.join(buildsRoot, 'build-escape-link');
  let escapeLinkCreated = false;
  try {
    await fs.mkdir(escapeTargetRoot, { recursive: true });
    await writeJson(path.join(escapeTargetRoot, 'build_state.json'), {
      schemaVersion: 1,
      buildId: 'escape-build',
      configHash: 'cfg-escape-build',
      tool: { version: '1.0.0' },
      validation: { ok: true, issueCount: 0, warningCount: 0, issues: [] }
    });
    await fs.symlink(escapeTargetRoot, escapeLinkRoot, process.platform === 'win32' ? 'junction' : 'dir');
    escapeLinkCreated = true;
  } catch {}
  if (escapeLinkCreated) {
    await writeJson(path.join(buildsRoot, 'current.json'), {
      buildId: 'escape-build',
      buildRoot: 'builds/build-escape-link',
      buildRoots: { code: 'builds/build-escape-link' }
    });
    await assert.rejects(
      () => createPointerSnapshot({
        repoRoot,
        userConfig,
        modes: ['code'],
        snapshotId: 'snap-20260212000000-aa0003'
      }),
      /escapes repo cache root/
    );
  }

  await writeBuildState({
    repoCacheRoot,
    buildId: 'build-invalid',
    validationOk: false
  });
  await writeJson(path.join(buildsRoot, 'current.json'), {
    buildId: 'build-invalid',
    buildRoot: 'builds/build-invalid',
    buildRoots: { code: 'builds/build-invalid' }
  });
  await assert.rejects(
    () => createPointerSnapshot({
      repoRoot,
      userConfig,
      modes: ['code'],
      snapshotId: 'snap-20260212000000-aa0004'
    }),
    /validation\.ok === true/
  );

  await writeBuildState({
    repoCacheRoot,
    buildId: 'build-missing-validation',
    includeValidation: false
  });
  await writeJson(path.join(buildsRoot, 'current.json'), {
    buildId: 'build-missing-validation',
    buildRoot: 'builds/build-missing-validation',
    buildRoots: { code: 'builds/build-missing-validation' }
  });
  await assert.rejects(
    () => createPointerSnapshot({
      repoRoot,
      userConfig,
      modes: ['code'],
      snapshotId: 'snap-20260212000000-aa0005'
    }),
    /validation\.ok === true/
  );

  await writeJson(path.join(buildsRoot, 'current.json'), {
    buildId: 'build-code',
    buildRoot: 'builds/build-code',
    buildRoots: { code: 'builds/build-code' }
  });
  const retentionIds = [
    'snap-20260212000000-aa0006',
    'snap-20260212000000-aa0007',
    'snap-20260212000000-aa0008'
  ];
  for (const snapshotId of retentionIds) {
    await createPointerSnapshot({
      repoRoot,
      userConfig,
      modes: ['code'],
      snapshotId,
      maxPointerSnapshots: 2
    });
  }

  const manifestAfterRetention = loadSnapshotsManifest(repoCacheRoot);
  const allEntries = Object.values(manifestAfterRetention.snapshots || {});
  const untaggedPointers = allEntries.filter((entry) => (
    entry.kind === 'pointer' && (!Array.isArray(entry.tags) || entry.tags.length === 0)
  ));
  assert.equal(untaggedPointers.length, 2);
  assert.ok(manifestAfterRetention.snapshots['snap-20260212000000-aa0001']);
  assert.ok(!manifestAfterRetention.snapshots['snap-20260212000000-aa0006']);
  await assert.rejects(() => fs.stat(path.join(repoCacheRoot, 'snapshots', 'snap-20260212000000-aa0006')));
  const listedSnapshots = listSnapshots({ repoRoot, userConfig });
  assert.ok(listedSnapshots.length >= 3);
  const shownSnapshot = showSnapshot({
    repoRoot,
    userConfig,
    snapshotId: 'snap-20260212000000-aa0001'
  });
  assert.ok(shownSnapshot?.entry);

  const dryRunPrune = await pruneSnapshots({
    repoRoot,
    userConfig,
    maxPointerSnapshots: 1,
    dryRun: true
  });
  assert.ok(Array.isArray(dryRunPrune.removed));
  assert.ok(dryRunPrune.decisions.some((entry) => entry.reason === 'tagged' || entry.reason === 'pointer_budget'));

  const removableId = untaggedPointers.find((entry) => entry.snapshotId)?.snapshotId;
  assert.ok(removableId);
  await removeSnapshot({
    repoRoot,
    userConfig,
    snapshotId: removableId,
    force: true
  });
  const afterRemoveManifest = loadSnapshotsManifest(repoCacheRoot);
  assert.ok(!afterRemoveManifest.snapshots[removableId]);

  assert.ok(buildCodeRoot);
  assert.ok(buildProseRoot);
};

const runSnapshotFreezeCase = async () => {
  applyTestEnv();

  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, 'snapshot-freeze-service');
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');
  const userConfig = {
    cache: { root: cacheRoot },
    sqlite: { use: false },
    lmdb: { use: false }
  };

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(repoRoot, { recursive: true });
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });

  const goodBuildRoot = await seedFreezeBuildRoot({
    repoCacheRoot,
    buildId: 'build-freeze-good',
    corruptManifest: false
  });
  await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
    buildId: 'build-freeze-good',
    buildRoot: 'builds/build-freeze-good',
    buildRoots: { code: 'builds/build-freeze-good' }
  });

  const pointerSnapshot = await createPointerSnapshot({
    repoRoot,
    userConfig,
    modes: ['code'],
    snapshotId: 'snap-20260212000000-frz001'
  });
  assert.equal(pointerSnapshot.snapshotId, 'snap-20260212000000-frz001');

  const activeBuildLock = await acquireIndexLock({
    repoCacheRoot,
    waitMs: 0,
    metadata: {
      owner: 'build-index',
      operation: 'stage3-embeddings'
    }
  });
  assert.ok(activeBuildLock);
  try {
    const concurrentFreeze = await freezeSnapshot({
      repoRoot,
      userConfig,
      snapshotId: pointerSnapshot.snapshotId,
      modes: ['code'],
      method: 'hardlink',
      verify: true,
      waitMs: 0
    });
    assert.equal(concurrentFreeze.snapshotId, pointerSnapshot.snapshotId);
  } finally {
    await activeBuildLock.release();
  }

  const freezeResult = await freezeSnapshot({
    repoRoot,
    userConfig,
    snapshotId: pointerSnapshot.snapshotId,
    modes: ['code'],
    method: 'hardlink',
    verify: true
  });
  assert.equal(freezeResult.alreadyFrozen, true);
  assert.equal(freezeResult.retention?.tier ?? 'forensic', 'forensic');
  const frozenManifestAfterConcurrentFreeze = loadSnapshotsManifest(repoCacheRoot);
  assert.equal(
    frozenManifestAfterConcurrentFreeze.snapshots[pointerSnapshot.snapshotId]?.retention?.tier,
    'forensic'
  );

  const frozenMeta = loadFrozen(repoCacheRoot, pointerSnapshot.snapshotId);
  assert.equal(frozenMeta?.verification?.ok, true);
  const manifestAfterFreeze = loadSnapshotsManifest(repoCacheRoot);
  assert.equal(manifestAfterFreeze.snapshots[pointerSnapshot.snapshotId]?.hasFrozen, true);
  await fs.access(path.join(repoCacheRoot, 'snapshots', pointerSnapshot.snapshotId, 'frozen', 'index-code', 'chunk_meta.json'));

  const idempotent = await freezeSnapshot({
    repoRoot,
    userConfig,
    snapshotId: pointerSnapshot.snapshotId
  });
  assert.equal(idempotent.alreadyFrozen, true);

  await fs.rm(goodBuildRoot, { recursive: true, force: true });
  const resolvedFrozen = resolveIndexRef({
    ref: `snap:${pointerSnapshot.snapshotId}`,
    repoRoot,
    userConfig,
    requestedModes: ['code'],
    preferFrozen: true,
    allowMissingModes: false
  });
  assert.ok(
    resolvedFrozen.indexDirByMode.code.includes(path.join('snapshots', pointerSnapshot.snapshotId, 'frozen', 'index-code'))
  );

  await seedFreezeBuildRoot({
    repoCacheRoot,
    buildId: 'build-freeze-bad',
    corruptManifest: true
  });
  await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
    buildId: 'build-freeze-bad',
    buildRoot: 'builds/build-freeze-bad',
    buildRoots: { code: 'builds/build-freeze-bad' }
  });
  const badSnapshot = await createPointerSnapshot({
    repoRoot,
    userConfig,
    modes: ['code'],
    snapshotId: 'snap-20260212000000-frz002'
  });

  const escapeFreezeTarget = path.join(tempRoot, 'freeze-escape-target');
  const escapeFreezeLink = path.join(repoCacheRoot, 'builds', 'build-freeze-escape-link');
  let freezeEscapeLinkCreated = false;
  try {
    await fs.mkdir(path.join(escapeFreezeTarget, 'index-code'), { recursive: true });
    await fs.symlink(escapeFreezeTarget, escapeFreezeLink, process.platform === 'win32' ? 'junction' : 'dir');
    freezeEscapeLinkCreated = true;
  } catch {}
  if (freezeEscapeLinkCreated) {
    const escapeSnapshot = await createPointerSnapshot({
      repoRoot,
      userConfig,
      modes: ['code'],
      snapshotId: 'snap-20260212000000-frz003'
    });
    const escapeSnapshotPath = path.join(repoCacheRoot, 'snapshots', escapeSnapshot.snapshotId, 'snapshot.json');
    const escapeSnapshotJson = JSON.parse(await fs.readFile(escapeSnapshotPath, 'utf8'));
    escapeSnapshotJson.pointer = {
      ...(escapeSnapshotJson.pointer || {}),
      buildRootsByMode: {
        ...(escapeSnapshotJson.pointer?.buildRootsByMode || {}),
        code: 'builds/build-freeze-escape-link'
      }
    };
    await fs.writeFile(escapeSnapshotPath, `${JSON.stringify(escapeSnapshotJson, null, 2)}\n`, 'utf8');

    await assert.rejects(
      () => freezeSnapshot({
        repoRoot,
        userConfig,
        snapshotId: escapeSnapshot.snapshotId,
        modes: ['code'],
        method: 'copy'
      }),
      /escapes repo cache root/
    );
  }

  await assert.rejects(
    () => freezeSnapshot({
      repoRoot,
      userConfig,
      snapshotId: badSnapshot.snapshotId,
      modes: ['code'],
      method: 'copy',
      verify: true
    }),
    /Checksum mismatch/
  );
  await assert.rejects(() => fs.stat(path.join(repoCacheRoot, 'snapshots', badSnapshot.snapshotId, 'frozen')));
  assert.equal(loadSnapshotsManifest(repoCacheRoot).snapshots[badSnapshot.snapshotId]?.hasFrozen, false);
};

const runIndexDiffCase = async () => {
  applyTestEnv();

  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, 'index-diff-service');
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');
  const userConfig = {
    cache: { root: cacheRoot },
    sqlite: { use: false },
    lmdb: { use: false }
  };

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(repoRoot, { recursive: true });
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });

  await seedDiffBuild({
    repoCacheRoot,
    buildId: 'build-a',
    files: [
      { file: 'src/a.js', content: 'export const a = 1;', chunkId: 'chunk-a' }
    ],
    chunkSignature: { 'src/a.js': 'sig-a' },
    configHash: 'cfg-shared',
    toolVersion: '1.0.0'
  });
  await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
    buildId: 'build-a',
    buildRoot: 'builds/build-a',
    buildRoots: { code: 'builds/build-a' }
  });
  await createPointerSnapshot({
    repoRoot,
    userConfig,
    modes: ['code'],
    snapshotId: 'snap-20260212000000-diffa'
  });

  await seedDiffBuild({
    repoCacheRoot,
    buildId: 'build-b',
    files: [
      { file: 'src/a.js', content: 'export const a = 2;', chunkId: 'chunk-a' },
      { file: 'src/b.js', content: 'export const b = 1;', chunkId: 'chunk-b' }
    ],
    chunkSignature: { 'src/a.js': 'sig-b', 'src/b.js': 'sig-new' },
    configHash: 'cfg-shared',
    toolVersion: '1.0.0'
  });
  await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
    buildId: 'build-b',
    buildRoot: 'builds/build-b',
    buildRoots: { code: 'builds/build-b' }
  });
  await createPointerSnapshot({
    repoRoot,
    userConfig,
    modes: ['code'],
    snapshotId: 'snap-20260212000000-diffb'
  });

  const first = await computeIndexDiff({
    repoRoot,
    userConfig,
    from: 'snap:snap-20260212000000-diffa',
    to: 'snap:snap-20260212000000-diffb',
    modes: ['code'],
    includeRelations: false,
    persist: true
  });
  assert.equal(first.persisted, true);
  assert.ok(first.diffId.startsWith('diff_'));
  assert.equal(first.retention?.tier, 'forensic');
  assert.ok(Number(first.summary?.totals?.byKind?.['file.modified'] || 0) >= 1);

  const shown = showDiff({
    repoRoot,
    userConfig,
    diffId: first.diffId,
    format: 'jsonl'
  });
  assert.ok(Array.isArray(shown.events) && shown.events.length > 0);
  const chunkModified = shown.events.find((event) => event.kind === 'chunk.modified');
  assert.ok(chunkModified);
  assert.equal(chunkModified.chunkId, 'chunk-a');

  const second = await computeIndexDiff({
    repoRoot,
    userConfig,
    from: 'snap:snap-20260212000000-diffa',
    to: 'snap:snap-20260212000000-diffb',
    modes: ['code'],
    includeRelations: false,
    persist: true
  });
  assert.equal(second.diffId, first.diffId);
  assert.equal(second.reused, true);

  const activeBuildLock = await acquireIndexLock({
    repoCacheRoot,
    waitMs: 0,
    metadata: {
      owner: 'build-index',
      operation: 'stage4-promote'
    }
  });
  assert.ok(activeBuildLock);
  try {
    const underIndexLock = await computeIndexDiff({
      repoRoot,
      userConfig,
      from: 'snap:snap-20260212000000-diffa',
      to: 'snap:snap-20260212000000-diffb',
      modes: ['code'],
      includeRelations: false,
      persist: true
    });
    assert.equal(underIndexLock.diffId, first.diffId);
  } finally {
    await activeBuildLock.release();
  }

  const truncated = await computeIndexDiff({
    repoRoot,
    userConfig,
    from: 'snap:snap-20260212000000-diffa',
    to: 'snap:snap-20260212000000-diffb',
    modes: ['code'],
    includeRelations: false,
    persist: false,
    maxEvents: 1
  });
  assert.equal(truncated.summary.truncated, true);
  assert.equal(Array.isArray(truncated.events) ? truncated.events.length : 0, 1);

  await seedDiffBuild({
    repoCacheRoot,
    buildId: 'build-c',
    files: [
      { file: 'src/a.js', content: 'export const a = 3;', chunkId: 'chunk-a' }
    ],
    chunkSignature: { 'src/a.js': 'sig-c' },
    configHash: 'cfg-different',
    toolVersion: '1.0.0'
  });
  await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
    buildId: 'build-c',
    buildRoot: 'builds/build-c',
    buildRoots: { code: 'builds/build-c' }
  });
  await createPointerSnapshot({
    repoRoot,
    userConfig,
    modes: ['code'],
    snapshotId: 'snap-20260212000000-diffc'
  });

  await assert.rejects(
    () => computeIndexDiff({
      repoRoot,
      userConfig,
      from: 'snap:snap-20260212000000-diffa',
      to: 'snap:snap-20260212000000-diffc',
      modes: ['code'],
      persist: false
    }),
    /configHash mismatch/
  );

  const mismatchAllowed = await computeIndexDiff({
    repoRoot,
    userConfig,
    from: 'snap:snap-20260212000000-diffa',
    to: 'snap:snap-20260212000000-diffc',
    modes: ['code'],
    allowMismatch: true,
    persist: false
  });
  assert.equal(mismatchAllowed.summary.compat.configHashMismatch, true);

  await seedDiffBuild({
    repoCacheRoot,
    buildId: 'build-d',
    files: [
      { file: 'src/a.js', content: 'export const a = 4;', chunkId: 'chunk-a' }
    ],
    chunkSignature: { 'src/a.js': 'sig-d' },
    configHash: 'cfg-shared',
    toolVersion: '9.9.9'
  });
  await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
    buildId: 'build-d',
    buildRoot: 'builds/build-d',
    buildRoots: { code: 'builds/build-d' }
  });
  await createPointerSnapshot({
    repoRoot,
    userConfig,
    modes: ['code'],
    snapshotId: 'snap-20260212000000-diffd'
  });

  const toolMismatch = await computeIndexDiff({
    repoRoot,
    userConfig,
    from: 'snap:snap-20260212000000-diffa',
    to: 'snap:snap-20260212000000-diffd',
    modes: ['code'],
    persist: false
  });
  assert.equal(toolMismatch.summary.compat.toolVersionMismatch, true);

  const pinnedDiff = await computeIndexDiff({
    repoRoot,
    userConfig,
    from: 'snap:snap-20260212000000-diffa',
    to: 'snap:snap-20260212000000-diffd',
    modes: ['code'],
    allowMismatch: true,
    persist: true,
    retentionTier: 'pinned'
  });
  assert.equal(pinnedDiff.retention?.tier, 'pinned');

  const cacheDiff = await computeIndexDiff({
    repoRoot,
    userConfig,
    from: 'snap:snap-20260212000000-diffa',
    to: 'snap:snap-20260212000000-diffd',
    modes: ['code'],
    allowMismatch: true,
    persist: true,
    retentionTier: 'cache',
    includeRelations: false
  });
  assert.equal(cacheDiff.retention?.tier, 'cache');

  const agedDiffManifest = loadDiffsManifest(repoCacheRoot);
  agedDiffManifest.diffs[cacheDiff.diffId] = {
    ...agedDiffManifest.diffs[cacheDiff.diffId],
    createdAt: '2025-01-01T00:00:00.000Z'
  };
  agedDiffManifest.updatedAt = new Date().toISOString();
  await writeDiffsManifest(repoCacheRoot, agedDiffManifest);

  const pruneResult = await pruneDiffs({
    repoRoot,
    userConfig,
    maxDiffs: 0,
    retainDays: 30,
    dryRun: true
  });
  assert.ok(pruneResult.decisions.some((entry) => entry.diffId === first.diffId && entry.reason === 'max_age'));
  assert.ok(pruneResult.decisions.some((entry) => entry.diffId === pinnedDiff.diffId && entry.reason === 'pinned'));
  assert.ok(pruneResult.decisions.some((entry) => entry.diffId === cacheDiff.diffId && entry.action === 'remove'));

  await seedDiffBuild({
    repoCacheRoot,
    buildId: 'build-e',
    files: [],
    chunkSignature: {},
    configHash: 'cfg-shared',
    toolVersion: '1.0.0',
    fileMetaRows: [
      {
        id: 1,
        file: 'src/many.js',
        hash: sha1Value('export const many = 1;'),
        size: 'export const many = 1;'.length,
        ext: 'js'
      }
    ],
    chunkMetaRows: [
      {
        id: 0,
        fileId: 1,
        file: 'src/many.js',
        start: 0,
        end: 22,
        startLine: 1,
        endLine: 1,
        kind: 'function',
        name: 'many-a',
        chunkId: 'many-chunk-a',
        metaV2: {
          chunkId: 'many-chunk-a',
          chunkUid: 'ck:build-e:many-chunk-a',
          signature: 'sig-many-e-a',
          virtualPath: 'src/many.js',
          file: 'src/many.js'
        }
      }
    ]
  });
  await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
    buildId: 'build-e',
    buildRoot: 'builds/build-e',
    buildRoots: { code: 'builds/build-e' }
  });
  await createPointerSnapshot({
    repoRoot,
    userConfig,
    modes: ['code'],
    snapshotId: 'snap-20260212000000-diffe'
  });

  await seedDiffBuild({
    repoCacheRoot,
    buildId: 'build-f',
    files: [],
    chunkSignature: {},
    configHash: 'cfg-shared',
    toolVersion: '1.0.0',
    fileMetaRows: [
      {
        id: 1,
        file: 'src/many.js',
        hash: sha1Value('export const many = 2;'),
        size: 'export const many = 2;'.length,
        ext: 'js'
      }
    ],
    chunkMetaRows: [
      {
        id: 0,
        fileId: 1,
        file: 'src/many.js',
        start: 0,
        end: 11,
        startLine: 1,
        endLine: 1,
        kind: 'function',
        name: 'many-a',
        chunkId: 'many-chunk-a',
        metaV2: {
          chunkId: 'many-chunk-a',
          chunkUid: 'ck:build-f:many-chunk-a',
          signature: 'sig-many-f-a',
          virtualPath: 'src/many.js',
          file: 'src/many.js'
        }
      },
      {
        id: 1,
        fileId: 1,
        file: 'src/many.js',
        start: 11,
        end: 22,
        startLine: 1,
        endLine: 1,
        kind: 'function',
        name: 'many-b',
        chunkId: 'many-chunk-b',
        metaV2: {
          chunkId: 'many-chunk-b',
          chunkUid: 'ck:build-f:many-chunk-b',
          signature: 'sig-many-f-b',
          virtualPath: 'src/many.js',
          file: 'src/many.js'
        }
      }
    ]
  });
  await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
    buildId: 'build-f',
    buildRoot: 'builds/build-f',
    buildRoots: { code: 'builds/build-f' }
  });
  await createPointerSnapshot({
    repoRoot,
    userConfig,
    modes: ['code'],
    snapshotId: 'snap-20260212000000-difff'
  });

  const chunkLimited = await computeIndexDiff({
    repoRoot,
    userConfig,
    from: 'snap:snap-20260212000000-diffe',
    to: 'snap:snap-20260212000000-difff',
    modes: ['code'],
    includeRelations: false,
    maxChunksPerFile: 1,
    persist: false
  });
  assert.equal(chunkLimited.summary?.modesSummary?.code?.limits?.chunkDiffSkipped, true);
  assert.equal(chunkLimited.summary?.modesSummary?.code?.limits?.reason, 'max-chunks-per-file');
};

await runSnapshotCreateCase();
await runSnapshotFreezeCase();
await runIndexDiffCase();

console.log('snapshot core contract matrix test passed');

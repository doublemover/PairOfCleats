#!/usr/bin/env node
import { applyTestEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getRepoCacheRoot } from '../../src/shared/dict-utils.js';
import { createPointerSnapshot } from '../../src/index/snapshots/create.js';
import { freezeSnapshot } from '../../src/index/snapshots/freeze.js';
import { resolveIndexRef } from '../../src/index/index-ref.js';
import { loadFrozen, loadSnapshotsManifest } from '../../src/index/snapshots/registry.js';
import { replaceDir } from '../../src/shared/json-stream/atomic.js';
import { createBaseIndex } from '../indexing/validate/helpers.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

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

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

const seedBuildRoot = async ({
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

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });

const goodBuildRoot = await seedBuildRoot({
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

const freezeResult = await freezeSnapshot({
  repoRoot,
  userConfig,
  snapshotId: pointerSnapshot.snapshotId,
  modes: ['code'],
  method: 'hardlink',
  verify: true
});
assert.equal(freezeResult.alreadyFrozen, false, 'first freeze should materialize frozen data');
assert.equal(freezeResult.verificationOk, true, 'freeze verification should pass');
assert.ok(Number.isFinite(freezeResult.filesChecked), 'freeze should report verification file count');

const frozenMeta = loadFrozen(repoCacheRoot, pointerSnapshot.snapshotId);
assert.equal(frozenMeta?.verification?.ok, true, 'frozen.json must record successful verification');
const manifestAfterFreeze = loadSnapshotsManifest(repoCacheRoot);
assert.equal(
  manifestAfterFreeze.snapshots[pointerSnapshot.snapshotId]?.hasFrozen,
  true,
  'manifest entry must be marked hasFrozen=true'
);
await fs.access(path.join(repoCacheRoot, 'snapshots', pointerSnapshot.snapshotId, 'frozen', 'index-code', 'chunk_meta.json'));

const idempotent = await freezeSnapshot({
  repoRoot,
  userConfig,
  snapshotId: pointerSnapshot.snapshotId
});
assert.equal(idempotent.alreadyFrozen, true, 'second freeze should be idempotent');

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
  resolvedFrozen.indexDirByMode.code.includes(path.join('snapshots', pointerSnapshot.snapshotId, 'frozen', 'index-code')),
  'resolved snapshot should use frozen roots after source build is removed'
);

const badBuildRoot = await seedBuildRoot({
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
    /escapes repo cache root/,
    'freeze should reject pointer roots that escape via symlink'
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
  /Checksum mismatch/,
  'freeze should fail when copied pieces fail checksum verification'
);
await assert.rejects(
  () => fs.stat(path.join(repoCacheRoot, 'snapshots', badSnapshot.snapshotId, 'frozen')),
  'failed freeze must not finalize frozen directory'
);
assert.equal(
  loadSnapshotsManifest(repoCacheRoot).snapshots[badSnapshot.snapshotId]?.hasFrozen,
  false,
  'failed freeze should keep hasFrozen=false'
);

assert.ok(badBuildRoot);

console.log('snapshot freeze service test passed');

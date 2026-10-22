import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPointerSnapshot, pruneSnapshots } from '../../src/index/snapshots/create.js';
import { gcSnapshots } from '../../src/index/snapshots/freeze.js';
import { loadSnapshotsManifest, writeSnapshotsManifest } from '../../src/index/snapshots/registry.js';
import { getRepoCacheRoot } from '../../src/shared/dict-utils.js';
import { seedCodeSnapshotBuildRoot, setCurrentCodeSnapshotBuild } from '../helpers/snapshot-build-fixture.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('snapshot-pruning-policy');
const repoRoot = path.join(dir, 'repo');
const userConfig = { cache: { root: path.join(dir, 'cache') }, sqlite: { use: false } };
await fs.mkdir(repoRoot, { recursive: true });
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
await seedCodeSnapshotBuildRoot({ repoCacheRoot, buildId: 'build-policy' });
await setCurrentCodeSnapshotBuild({ repoCacheRoot, buildId: 'build-policy' });
const snapshots = {};
for (const [id, tier, tags] of [['snap-pin', 'pinned', []], ['snap-forensic', 'forensic', []],
  ['snap-tagged', 'cache', ['release']], ['snap-old-cache', 'cache', []]]) {
  snapshots[id] = { snapshotId: id, createdAt: '2000-01-01T00:00:00.000Z', kind: 'pointer',
    tags, hasFrozen: false, retention: { tier } };
  await fs.mkdir(path.join(repoCacheRoot, 'snapshots', id), { recursive: true });
  await fs.writeFile(path.join(repoCacheRoot, 'snapshots', id, 'sentinel'), id);
}
await writeSnapshotsManifest(repoCacheRoot, { version: 1, updatedAt: null, snapshots, tags: { release: ['snap-tagged'] } });
const created = await createPointerSnapshot({ repoRoot, userConfig, modes: ['code'], snapshotId: 'snap-new-cache', maxPointerSnapshots: 1 });
assert.deepEqual(created.removedByRetention, ['snap-old-cache']);
for (const id of ['snap-pin', 'snap-forensic', 'snap-tagged']) {
  assert.equal(await fs.readFile(path.join(repoCacheRoot, 'snapshots', id, 'sentinel'), 'utf8'), id);
  assert.ok(loadSnapshotsManifest(repoCacheRoot).snapshots[id]);
}
for (const dryRun of [true, false]) {
  const pruned = await pruneSnapshots({ repoRoot, userConfig, maxPointerSnapshots: 1, dryRun });
  assert.deepEqual(pruned.removed, []);
  assert.ok(pruned.decisions.some(entry => entry.snapshotId === 'snap-pin' && entry.reason === 'pinned'));
  assert.ok(pruned.decisions.some(entry => entry.snapshotId === 'snap-forensic' && entry.reason === 'forensic_retention'));
}
const gc = await gcSnapshots({ repoRoot, userConfig, keepPointer: 0, keepFrozen: 0, maxAgeDays: 0, dryRun: true });
assert.ok(gc.removed.includes('snap-forensic'), 'explicit GC age policy owns forensic expiry');
assert.ok(!gc.removed.includes('snap-pin'));
assert.ok(!gc.removed.includes('snap-tagged'));
assert.ok(loadSnapshotsManifest(repoCacheRoot).snapshots['snap-forensic']);
const manifestPath = path.join(repoCacheRoot, 'snapshots/manifest.json');
const tampered = loadSnapshotsManifest(repoCacheRoot);
tampered.snapshots['snap-invalid'] = { snapshotId: '../../../outside', kind: 'pointer' };
const tamperedBytes = JSON.stringify(tampered);
await fs.writeFile(manifestPath, tamperedBytes);
await assert.rejects(createPointerSnapshot({ repoRoot, userConfig, modes: ['code'], snapshotId: 'snap-refused', maxPointerSnapshots: 1 }),
  error => error?.code === 'INVALID_REQUEST');
assert.equal(await fs.readFile(manifestPath, 'utf8'), tamperedBytes);
await assert.rejects(fs.stat(path.join(repoCacheRoot, 'snapshots/snap-refused')), { code: 'ENOENT' });
for (const id of ['snap-pin', 'snap-forensic', 'snap-tagged']) {
  assert.equal(await fs.readFile(path.join(repoCacheRoot, 'snapshots', id, 'sentinel'), 'utf8'), id);
}
console.log('Creation and explicit pruning retain pinned/forensic/tagged bytes; full GC owns forensic expiry.');

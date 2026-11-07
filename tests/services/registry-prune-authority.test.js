import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { getRepoCacheRoot } from '../../src/shared/dict-utils.js';
import { gcSnapshots } from '../../src/index/snapshots/freeze.js';
import { pruneSnapshots } from '../../src/index/snapshots/create.js';
import { pruneDiffs } from '../../src/index/diffs/compute.js';
import { loadSnapshotsManifest, writeSnapshotsManifest } from '../../src/index/snapshots/registry.js';
import { loadDiffsManifest, writeDiffsManifest } from '../../src/index/diffs/registry.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('registry-prune-authority');
const repoRoot = path.join(dir, 'repo');
const userConfig = { cache: { root: path.join(dir, 'cache') } };
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const outside = path.join(dir, 'outside');
await fs.mkdir(outside, { recursive: true });
await fs.writeFile(path.join(outside, 'sentinel'), 'outside bytes');
const invalidRequest = error => error?.code === 'INVALID_REQUEST';
for (const domain of ['snapshots', 'diffs']) {
  const root = path.join(repoCacheRoot, domain);
  await fs.mkdir(root, { recursive: true });
  const manifestPath = path.join(root, 'manifest.json');
  const snapshot = domain === 'snapshots';
  const validId = snapshot ? 'snap-valid' : 'diff_valid';
  const idField = snapshot ? 'snapshotId' : 'id';
  const entry = id => ({ [idField]: id, createdAt: '2000-01-01T00:00:00.000Z',
    kind: 'pointer', tags: [], hasFrozen: false, retention: { tier: 'cache' } });
  const manifest = entries => ({ version: 1, updatedAt: null, [domain]: entries,
    ...(snapshot ? { tags: {} } : {}) });
  const load = snapshot ? loadSnapshotsManifest : loadDiffsManifest;
  const write = snapshot ? writeSnapshotsManifest : writeDiffsManifest;
  const operations = snapshot ? [
    dryRun => gcSnapshots({ repoRoot, userConfig, keepPointer: 0, keepFrozen: 0, maxAgeDays: 0, dryRun }),
    dryRun => pruneSnapshots({ repoRoot, userConfig, maxPointerSnapshots: 1, dryRun })
  ] : [dryRun => pruneDiffs({ repoRoot, userConfig, maxDiffs: 0, retainDays: 0, dryRun })];
  await fs.mkdir(path.join(root, validId), { recursive: true });
  await fs.writeFile(path.join(root, validId, 'sentinel'), 'retained until validation');
  const badEntries = [
    ...['../../../outside', '..\\..\\outside', '/absolute', 'C:\\absolute', '.', '..', 'a/b', 'a\\b']
      .map(id => ({ [id]: entry(id) })),
    { [validId]: entry(snapshot ? 'snap-other' : 'diff_other') },
    { [validId]: null }
  ];
  for (const bad of badEntries) {
    const payload = manifest({ [validId]: entry(validId), ...bad });
    const bytes = JSON.stringify(payload);
    await fs.writeFile(manifestPath, bytes);
    assert.throws(() => load(repoCacheRoot), invalidRequest);
    await assert.rejects(write(repoCacheRoot, payload), invalidRequest);
    for (const operation of operations) {
      for (const dryRun of [true, false]) await assert.rejects(operation(dryRun), invalidRequest);
    }
    assert.equal(await fs.readFile(manifestPath, 'utf8'), bytes, 'invalid registry must not be rewritten');
    assert.equal(await fs.readFile(path.join(root, validId, 'sentinel'), 'utf8'), 'retained until validation');
    assert.equal(await fs.readFile(path.join(outside, 'sentinel'), 'utf8'), 'outside bytes');
  }
  const linkedId = snapshot ? 'snap-linked' : 'diff_linked';
  const linkedPath = path.join(root, linkedId);
  await fs.mkdir(linkedPath);
  const lstatSync = fsSync.lstatSync;
  fsSync.lstatSync = (file, options) => {
    const stat = lstatSync(file, options);
    return path.resolve(file) === linkedPath ? { ...stat, isSymbolicLink: () => true } : stat;
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest({ [linkedId]: entry(linkedId) })));
  try {
    for (const operation of operations) await assert.rejects(operation(false), invalidRequest);
  } finally { fsSync.lstatSync = lstatSync; }
  assert.equal(await fs.readFile(path.join(outside, 'sentinel'), 'utf8'), 'outside bytes');
  await fs.rmdir(linkedPath);
  await write(repoCacheRoot, manifest({ [validId]: entry(validId) }));
  const applied = await operations[0](false);
  assert.deepEqual(applied.removed, [validId], 'valid owned entries remain prunable');
  await assert.rejects(fs.stat(path.join(root, validId)), { code: 'ENOENT' });
}
console.log('Snapshot/diff prune rejects malformed and linked registry entries before any deletion or rewrite.');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPointerSnapshot } from '../../src/index/snapshots/create.js';
import { freezeSnapshot } from '../../src/index/snapshots/freeze.js';
import { loadFrozen, loadSnapshotsManifest } from '../../src/index/snapshots/registry.js';
import { getRepoCacheRoot } from '../../src/shared/dict-utils.js';
import { seedCodeSnapshotBuildRoot, setCurrentCodeSnapshotBuild } from '../helpers/snapshot-build-fixture.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { delayFileReadClose } from '../helpers/delayed-read-close.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('snapshot-freeze-integrity');
const repoRoot = path.join(dir, 'repo');
const userConfig = { cache: { root: path.join(dir, 'cache') }, sqlite: { use: false } };
await fs.mkdir(repoRoot, { recursive: true });
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const { buildRoot, indexDir } = await seedCodeSnapshotBuildRoot({ repoCacheRoot, buildId: 'build-integrity' });
await setCurrentCodeSnapshotBuild({ repoCacheRoot, buildId: 'build-integrity' });
for (const name of ['index-sqlite/code.db', 'index-lmdb/data.mdb']) {
  await fs.mkdir(path.dirname(path.join(buildRoot, name)), { recursive: true });
  await fs.writeFile(path.join(buildRoot, name), 'original database bytes');
}
const originalChunk = await fs.readFile(path.join(indexDir, 'chunk_meta.json'));
const frozen = [];
const observer = delayFileReadClose();
const rename = fs.rename;
fs.rename = async (from, to) => {
  if (path.basename(from).startsWith('frozen.staging-') && path.basename(to) === 'frozen') {
    assert.equal(observer.activeHandles, 0, 'promotion must wait for actual hash-descriptor closure');
  }
  return rename(from, to);
};
try {
  for (const [suffix, method, verify] of [['default', undefined, true], ['legacy', 'hardlink', true], ['unchecked', 'copy', false]]) {
    const snapshotId = `snap-${suffix}`;
    await createPointerSnapshot({ repoRoot, userConfig, modes: ['code'], snapshotId, retentionTier: 'pinned' });
    const result = await freezeSnapshot({ repoRoot, userConfig, snapshotId, method, verify, includeSqlite: true, includeLmdb: true });
    assert.equal(result.method, 'copy', 'legacy hardlink requests must preserve independent immutable bytes');
    const metadata = loadFrozen(repoCacheRoot, snapshotId);
    assert.equal(metadata.verification.ok, verify);
    assert.equal(metadata.verification.status, verify ? 'verified' : 'skipped');
    assert.equal(metadata.verification.filesChecked === null, !verify);
    assert.equal(loadSnapshotsManifest(repoCacheRoot).snapshots[snapshotId].retention.tier, 'pinned');
    const frozenRoot = path.join(repoCacheRoot, 'snapshots', snapshotId, 'frozen');
    assert.deepEqual(await fs.readFile(path.join(frozenRoot, 'index-code/chunk_meta.json')), originalChunk);
    frozen.push(frozenRoot);
  }
} finally { fs.rename = rename; observer.restore(); }
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), Buffer.alloc(originalChunk.length, 32));
for (const name of ['index-sqlite/code.db', 'index-lmdb/data.mdb']) await fs.writeFile(path.join(buildRoot, name), 'modified database bytes');
for (const frozenRoot of frozen) {
  assert.deepEqual(await fs.readFile(path.join(frozenRoot, 'index-code/chunk_meta.json')), originalChunk);
  for (const name of ['index-sqlite/code.db', 'index-lmdb/data.mdb']) {
    assert.equal(await fs.readFile(path.join(frozenRoot, name), 'utf8'), 'original database bytes');
  }
}
console.log('Frozen default/legacy requests retain independent mode, SQLite and LMDB bytes; unchecked verification is explicit.');

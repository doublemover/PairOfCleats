import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gcSnapshots } from '../../src/index/snapshots/freeze.js';
import { getRepoCacheRoot } from '../../src/shared/dict-utils.js';
import { createEmptySnapshotsManifest, writeSnapshotsManifest } from '../../src/index/snapshots/registry.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('snapshot-staging-dry-run');
const repoRoot = path.join(dir, 'repo');
const userConfig = { cache: { root: path.join(dir, 'cache') } };
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const root = path.join(repoCacheRoot, 'snapshots');
await writeSnapshotsManifest(repoCacheRoot, createEmptySnapshotsManifest());
const stale = ['frozen.staging-root', 'snap-old/frozen.staging-nested'].map(name => path.join(root, name));
const fresh = path.join(root, 'snap-old/frozen.staging-fresh');
for (const location of [...stale, fresh]) {
  await fs.mkdir(location, { recursive: true });
  await fs.writeFile(path.join(location, 'sentinel'), 'staging bytes');
}
for (const location of stale) await fs.utimes(location, new Date(0), new Date(0));
const dry = await gcSnapshots({ repoRoot, userConfig, dryRun: true });
assert.deepEqual(dry.staleStaging.removed, []);
assert.deepEqual([...dry.staleStaging.planned].sort(), [...stale].sort());
for (const location of [...stale, fresh]) assert.equal(await fs.readFile(path.join(location, 'sentinel'), 'utf8'), 'staging bytes');
const applied = await gcSnapshots({ repoRoot, userConfig });
assert.deepEqual([...applied.staleStaging.removed].sort(), [...stale].sort());
for (const location of stale) await assert.rejects(fs.stat(location), { code: 'ENOENT' });
assert.equal(await fs.readFile(path.join(fresh, 'sentinel'), 'utf8'), 'staging bytes');
console.log('GC staging plans match actual eligible cleanup without dry-run deletion.');

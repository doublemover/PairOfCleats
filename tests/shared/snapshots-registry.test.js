#!/usr/bin/env node
import { applyTestEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireIndexLock } from '../../src/index/build/lock.js';
import {
  cleanupStaleFrozenStagingDirs,
  createEmptySnapshotsManifest,
  loadSnapshotsManifest,
  writeSnapshotsManifest
} from '../../src/index/snapshots/registry.js';
import { stableStringify } from '../../src/shared/stable-json.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'snapshots-registry');
const repoCacheRoot = path.join(tempRoot, 'repo-cache');
const snapshotsRoot = path.join(repoCacheRoot, 'snapshots');
const manifestPath = path.join(snapshotsRoot, 'manifest.json');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(snapshotsRoot, { recursive: true });

const manifest = {
  version: 1,
  updatedAt: '2026-02-12T00:00:00.000Z',
  snapshots: {
    'snap-20260212-abcd': {
      snapshotId: 'snap-20260212-abcd',
      createdAt: '2026-02-12T00:00:00.000Z',
      kind: 'pointer',
      tags: ['release'],
      hasFrozen: false
    }
  },
  tags: {
    release: ['snap-20260212-abcd']
  }
};
await writeSnapshotsManifest(repoCacheRoot, manifest);

const manifestRaw = await fs.readFile(manifestPath, 'utf8');
assert.equal(
  manifestRaw,
  `${stableStringify(manifest)}\n`,
  'manifest should be written atomically with stable JSON ordering'
);

await fs.writeFile(`${manifestPath}.tmp-orphan`, '{not-valid-json');
const loaded = loadSnapshotsManifest(repoCacheRoot);
assert.deepEqual(loaded, manifest, 'orphan temp writes must not corrupt registry reads');

const lock = await acquireIndexLock({ repoCacheRoot, waitMs: 0 });
assert.ok(lock, 'expected to acquire index lock');
try {
  await assert.rejects(
    () => writeSnapshotsManifest(repoCacheRoot, createEmptySnapshotsManifest(), { waitMs: 0 }),
    (err) => err?.code === 'QUEUE_OVERLOADED',
    'manifest writes should fail fast when lock is held'
  );
} finally {
  await lock.release();
}

const oldDir = path.join(snapshotsRoot, 'snap-20260212-abcd', 'frozen.staging-old');
const freshDir = path.join(snapshotsRoot, 'snap-20260212-abcd', 'frozen.staging-fresh');
await fs.mkdir(oldDir, { recursive: true });
await fs.mkdir(freshDir, { recursive: true });
const nowMs = Date.now();
const twoDaysMs = 48 * 60 * 60 * 1000;
await fs.utimes(oldDir, new Date(nowMs - twoDaysMs), new Date(nowMs - twoDaysMs));
await fs.utimes(freshDir, new Date(nowMs), new Date(nowMs));

const cleanup = await cleanupStaleFrozenStagingDirs(repoCacheRoot, {
  maxAgeHours: 24,
  nowMs
});
assert.ok(cleanup.removed.includes(oldDir), 'stale staging dir should be removed');
await assert.rejects(() => fs.stat(oldDir), 'stale staging dir should not exist');
await fs.stat(freshDir);

console.log('snapshots registry test passed');


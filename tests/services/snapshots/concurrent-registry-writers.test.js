#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import {
  loadSnapshotsManifest,
  writeSnapshotsManifest
} from '../../../src/index/snapshots/registry.js';
import {
  loadDiffsManifest,
  writeDiffsManifest
} from '../../../src/index/diffs/registry.js';

process.env.PAIROFCLEATS_TESTING = '1';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-concurrent-registry-'));
const repoCacheRoot = path.join(tempRoot, 'repo-cache');
await fs.mkdir(repoCacheRoot, { recursive: true });

const snapshotsManifestA = {
  version: 1,
  updatedAt: '2026-02-12T00:00:00.000Z',
  snapshots: {
    'snap-20260212-a': {
      snapshotId: 'snap-20260212-a',
      createdAt: '2026-02-12T00:00:00.000Z',
      kind: 'pointer',
      tags: [],
      hasFrozen: false
    }
  },
  tags: {}
};
const snapshotsManifestB = {
  version: 1,
  updatedAt: '2026-02-12T00:00:10.000Z',
  snapshots: {},
  tags: {}
};

const diffsManifestA = {
  version: 1,
  updatedAt: '2026-02-12T00:00:00.000Z',
  diffs: {
    diff_contract: {
      id: 'diff_contract',
      createdAt: '2026-02-12T00:00:00.000Z',
      from: { ref: 'snap:snap-old' },
      to: { ref: 'snap:snap-new' },
      modes: ['code'],
      summaryPath: 'diffs/diff_contract/summary.json'
    }
  }
};
const diffsManifestB = {
  version: 1,
  updatedAt: '2026-02-12T00:00:10.000Z',
  diffs: {}
};

const lock = await acquireIndexLock({ repoCacheRoot, waitMs: 0 });
assert.ok(lock, 'expected to acquire index lock for contention test');
try {
  await writeSnapshotsManifest(repoCacheRoot, snapshotsManifestA, { lock });
  await assert.rejects(
    () => writeSnapshotsManifest(repoCacheRoot, snapshotsManifestB, { waitMs: 0 }),
    (error) => error?.code === 'QUEUE_OVERLOADED',
    'concurrent snapshot writer should fail fast while lock is held'
  );
  const snapshotManifestPath = path.join(repoCacheRoot, 'snapshots', 'manifest.json');
  await fs.writeFile(`${snapshotManifestPath}.tmp-interrupted`, '{broken', 'utf8');
  const loadedSnapshots = loadSnapshotsManifest(repoCacheRoot);
  assert.equal(loadedSnapshots.updatedAt, snapshotsManifestA.updatedAt);

  await writeDiffsManifest(repoCacheRoot, diffsManifestA, { lock });
  await assert.rejects(
    () => writeDiffsManifest(repoCacheRoot, diffsManifestB, { waitMs: 0 }),
    (error) => error?.code === 'QUEUE_OVERLOADED',
    'concurrent diff writer should fail fast while lock is held'
  );
  const diffManifestPath = path.join(repoCacheRoot, 'diffs', 'manifest.json');
  await fs.writeFile(`${diffManifestPath}.tmp-interrupted`, '{broken', 'utf8');
  const loadedDiffs = loadDiffsManifest(repoCacheRoot);
  assert.equal(loadedDiffs.updatedAt, diffsManifestA.updatedAt);
} finally {
  await lock.release();
}

console.log('concurrent registry writers test passed');

#!/usr/bin/env node
import { applyTestEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gcSnapshots } from '../../src/index/snapshots/freeze.js';
import { getRepoCacheRoot } from '../../src/shared/dict-utils.js';
import { writeSnapshotsManifest } from '../../src/index/snapshots/registry.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'snapshot-retention-governance');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const userConfig = { cache: { root: cacheRoot } };
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const snapshotsRoot = path.join(repoCacheRoot, 'snapshots');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(snapshotsRoot, { recursive: true });

const oldCreatedAt = '2025-01-01T00:00:00.000Z';
const freshCreatedAt = new Date().toISOString();
const manifest = {
  version: 1,
  updatedAt: freshCreatedAt,
  snapshots: {
    'snap-20260101000000-cache01': {
      snapshotId: 'snap-20260101000000-cache01',
      createdAt: oldCreatedAt,
      kind: 'pointer',
      tags: [],
      hasFrozen: false,
      retention: {
        tier: 'cache',
        reason: 'cache_default'
      }
    },
    'snap-20260101000000-frz001': {
      snapshotId: 'snap-20260101000000-frz001',
      createdAt: freshCreatedAt,
      kind: 'pointer',
      tags: [],
      hasFrozen: true,
      retention: {
        tier: 'forensic',
        reason: 'frozen_snapshot'
      }
    },
    'snap-20260101000000-pin001': {
      snapshotId: 'snap-20260101000000-pin001',
      createdAt: oldCreatedAt,
      kind: 'pointer',
      tags: ['release/v1.0.0'],
      hasFrozen: false,
      retention: {
        tier: 'pinned',
        reason: 'tagged'
      }
    }
  },
  tags: {
    'release/v1.0.0': ['snap-20260101000000-pin001']
  }
};
await writeSnapshotsManifest(repoCacheRoot, manifest);
for (const snapshotId of Object.keys(manifest.snapshots)) {
  await fs.mkdir(path.join(snapshotsRoot, snapshotId), { recursive: true });
}

const dryRun = await gcSnapshots({
  repoRoot,
  userConfig,
  keepPointer: 0,
  keepFrozen: 0,
  keepTags: 'release/*',
  maxAgeDays: 30,
  dryRun: true
});

assert.deepEqual(
  dryRun.removed,
  ['snap-20260101000000-cache01'],
  'cache-like snapshots should be the only dry-run removal in this governance shape'
);
assert.ok(
  dryRun.decisions.some((entry) => (
    entry.snapshotId === 'snap-20260101000000-frz001'
    && entry.action === 'keep'
    && entry.reason === 'max_age'
  )),
  'forensic snapshots should remain retained by the forensic age policy'
);
assert.ok(
  dryRun.decisions.some((entry) => (
    entry.snapshotId === 'snap-20260101000000-pin001'
    && entry.action === 'keep'
    && entry.reason === 'tag_pattern'
  )),
  'tagged pinned snapshots should remain protected with an explicit reason'
);
assert.ok(
  dryRun.decisions.some((entry) => (
    entry.snapshotId === 'snap-20260101000000-cache01'
    && entry.action === 'remove'
    && entry.reason === 'age_and_pointer_budget'
  )),
  'cache-like snapshots should report deterministic prune reasons'
);

console.log('snapshot retention governance test passed');

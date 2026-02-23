#!/usr/bin/env node
import { applyTestEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireIndexLock } from '../../src/index/build/lock.js';
import {
  createEmptyDiffsManifest,
  loadDiffInputs,
  loadDiffSummary,
  loadDiffsManifest,
  writeDiffInputs,
  writeDiffSummary,
  writeDiffsManifest
} from '../../src/index/diffs/registry.js';
import { stableStringify } from '../../src/shared/stable-json.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'diffs-registry');
const repoCacheRoot = path.join(tempRoot, 'repo-cache');
const diffsRoot = path.join(repoCacheRoot, 'diffs');
const manifestPath = path.join(diffsRoot, 'manifest.json');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(diffsRoot, { recursive: true });

const manifest = {
  version: 1,
  updatedAt: '2026-02-12T00:00:00.000Z',
  diffs: {
    diff_test123: {
      id: 'diff_test123',
      createdAt: '2026-02-12T00:00:00.000Z',
      from: { ref: 'snap:snap-old' },
      to: { ref: 'snap:snap-new' },
      modes: ['code'],
      summaryPath: 'diffs/diff_test123/summary.json'
    }
  }
};

await writeDiffsManifest(repoCacheRoot, manifest);
const manifestRaw = await fs.readFile(manifestPath, 'utf8');
assert.equal(manifestRaw, `${stableStringify(manifest)}\n`, 'diff manifest should be stable and atomic');
assert.deepEqual(loadDiffsManifest(repoCacheRoot), manifest);

await writeDiffInputs(repoCacheRoot, 'diff_test123', {
  id: 'diff_test123',
  createdAt: '2026-02-12T00:00:00.000Z',
  from: { ref: 'snap:snap-old' },
  to: { ref: 'snap:snap-new' },
  modes: ['code'],
  allowMismatch: false,
  identityHash: 'abc'
});
await writeDiffSummary(repoCacheRoot, 'diff_test123', {
  id: 'diff_test123',
  createdAt: '2026-02-12T00:00:00.000Z',
  from: { ref: 'snap:snap-old' },
  to: { ref: 'snap:snap-new' },
  modes: ['code']
});
assert.equal(loadDiffInputs(repoCacheRoot, 'diff_test123')?.id, 'diff_test123');
assert.equal(loadDiffSummary(repoCacheRoot, 'diff_test123')?.id, 'diff_test123');

const lock = await acquireIndexLock({ repoCacheRoot, waitMs: 0 });
assert.ok(lock, 'expected to acquire index lock');
try {
  await assert.rejects(
    () => writeDiffsManifest(repoCacheRoot, createEmptyDiffsManifest(), { waitMs: 0 }),
    (err) => err?.code === 'QUEUE_OVERLOADED',
    'diff manifest writes should fail fast when lock is held'
  );
} finally {
  await lock.release();
}

console.log('diffs registry test passed');


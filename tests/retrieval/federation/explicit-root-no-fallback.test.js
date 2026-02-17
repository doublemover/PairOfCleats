#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveIndexRef } from '../../../src/index/index-ref.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

applyTestEnv();

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-fed-explicit-root-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const userConfig = { cache: { root: cacheRoot } };
await fs.mkdir(repoRoot, { recursive: true });

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const buildsRoot = path.join(repoCacheRoot, 'builds');
const liveBuildRoot = path.join(buildsRoot, 'build-live');
await fs.mkdir(liveBuildRoot, { recursive: true });

const writeJson = async (targetPath, value) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

await writeJson(path.join(liveBuildRoot, 'build_state.json'), {
  schemaVersion: 1,
  buildId: 'build-live',
  configHash: 'cfg-live',
  tool: { version: '1.0.0' }
});
await writeJson(path.join(buildsRoot, 'current.json'), {
  buildRoot: 'builds/build-live',
  buildRootsByMode: { code: 'builds/build-live' }
});

const snapshotId = 'snap-20260212-explicit-nofallback';
const snapshotsRoot = path.join(repoCacheRoot, 'snapshots');
await writeJson(path.join(snapshotsRoot, 'manifest.json'), {
  version: 1,
  updatedAt: '2026-02-12T00:00:00.000Z',
  snapshots: {
    [snapshotId]: {
      snapshotId,
      createdAt: '2026-02-12T00:00:00.000Z',
      hasFrozen: false
    }
  },
  tags: {}
});
await writeJson(path.join(snapshotsRoot, snapshotId, 'snapshot.json'), {
  version: 1,
  snapshotId,
  kind: 'pointer',
  pointer: {
    buildRootsByMode: {
      code: 'builds/missing-build-root'
    },
    buildIdByMode: {
      code: 'build-missing'
    }
  }
});

assert.throws(
  () => resolveIndexRef({
    ref: `snap:${snapshotId}`,
    repoRoot,
    userConfig,
    requestedModes: ['code']
  }),
  /missing build root/i,
  'explicit snapshot refs must fail fast when their build roots are missing'
);

const latest = resolveIndexRef({
  ref: 'latest',
  repoRoot,
  userConfig,
  requestedModes: ['code']
});
assert.equal(latest.indexBaseRootByMode.code, liveBuildRoot);

console.log('federated explicit root no-fallback test passed');

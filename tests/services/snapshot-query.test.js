#!/usr/bin/env node
import { applyTestEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireIndexLock } from '../../src/index/build/lock.js';
import { resolveIndexRef } from '../../src/index/index-ref.js';
import { createPointerSnapshot } from '../../src/index/snapshots/create.js';
import { getRepoCacheRoot, loadUserConfig } from '../../tools/shared/dict-utils.js';
import { loadChunkMeta } from '../../src/shared/artifact-io.js';
import { replaceDir } from '../../src/shared/json-stream/atomic.js';
import { createBaseIndex } from '../indexing/validate/helpers.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

const tempRoot = resolveTestCachePath(process.cwd(), 'snapshot-query-service');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });

applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      embeddings: {
        enabled: false,
        mode: 'off',
        lancedb: { enabled: false },
        hnsw: { enabled: false }
      }
    }
  },
  extraEnv: { PAIROFCLEATS_WORKER_POOL: 'off' }
});

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const seedBuildRoot = async ({
  repoCacheRoot,
  buildId,
  token,
  end
}) => {
  const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
  await fs.mkdir(buildRoot, { recursive: true });
  const { indexDir } = await createBaseIndex({
    rootDir: buildRoot,
    chunkMeta: [
      {
        id: 0,
        file: 'src/phase14-snapshot-query.js',
        start: 0,
        end,
        text: `export const phase14_marker = "${token}";`
      }
    ],
    fileMeta: [
      {
        id: 0,
        file: 'src/phase14-snapshot-query.js',
        ext: '.js'
      }
    ],
    tokenPostings: {
      vocab: [token],
      postings: [
        [[0, 1]]
      ],
      docLengths: [1],
      avgDocLen: 1,
      totalDocs: 1
    }
  });
  const modeDir = path.join(buildRoot, 'index-code');
  await replaceDir(indexDir, modeDir);
  await fs.rm(path.join(buildRoot, '.index-root'), { recursive: true, force: true });
  await writeJson(path.join(buildRoot, 'build_state.json'), {
    schemaVersion: 1,
    buildId,
    configHash: `cfg-${buildId}`,
    tool: { version: '1.0.0' },
    validation: { ok: true, issueCount: 0, warningCount: 0, issues: [] }
  });
};

const markerPath = path.join(repoRoot, 'src', 'phase14-snapshot-query.js');
await fs.mkdir(path.dirname(markerPath), { recursive: true });
await fs.writeFile(markerPath, 'export const phase14_marker = "alpha";\n', 'utf8');

const userConfig = loadUserConfig(repoRoot);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });

await seedBuildRoot({
  repoCacheRoot,
  buildId: 'build-alpha',
  token: 'alpha',
  end: 38
});
await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
  buildId: 'build-alpha',
  buildRoot: 'builds/build-alpha',
  buildRoots: {
    code: 'builds/build-alpha'
  }
});

const snapshotA = 'snap-20260212000000-snapqa';
await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  snapshotId: snapshotA
});

await fs.writeFile(markerPath, 'export const phase14_marker = "beta";\n', 'utf8');
await seedBuildRoot({
  repoCacheRoot,
  buildId: 'build-beta',
  token: 'beta',
  end: 37
});
await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
  buildId: 'build-beta',
  buildRoot: 'builds/build-beta',
  buildRoots: {
    code: 'builds/build-beta'
  }
});

const snapshotB = 'snap-20260212000000-snapqb';
await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  snapshotId: snapshotB
});

const resolvedA = resolveIndexRef({
  ref: `snap:${snapshotA}`,
  repoRoot,
  userConfig,
  requestedModes: ['code'],
  preferFrozen: true,
  allowMissingModes: false
});
assert.equal(resolvedA.canonical, `snap:${snapshotA}`, 'snapshot alias should normalize to snap:<id>');
assert.equal(resolvedA.identity?.snapshotId, snapshotA);
const chunkMetaA = await loadChunkMeta(resolvedA.indexDirByMode.code, { strict: false });
assert.equal(chunkMetaA[0]?.file, 'src/phase14-snapshot-query.js');
assert.equal(chunkMetaA[0]?.end, 38, 'snapshot A should resolve its committed build root');

const activeBuildLock = await acquireIndexLock({
  repoCacheRoot,
  waitMs: 0,
  metadata: {
    owner: 'build-index',
    operation: 'stage4-promote'
  }
});
assert.ok(activeBuildLock, 'expected to acquire index lock for snapshot query concurrency test');

const resolvedAWhileLocked = resolveIndexRef({
  ref: `snap:${snapshotA}`,
  repoRoot,
  userConfig,
  requestedModes: ['code'],
  preferFrozen: true,
  allowMissingModes: false
});
const chunkMetaAWhileLocked = await loadChunkMeta(resolvedAWhileLocked.indexDirByMode.code, { strict: false });
assert.equal(
  chunkMetaAWhileLocked[0]?.end,
  38,
  'snapshot query resolution should remain readable while build-side mutations are blocked by the index lock'
);
await activeBuildLock.release();

const resolvedB = resolveIndexRef({
  ref: `snap:${snapshotB}`,
  repoRoot,
  userConfig,
  requestedModes: ['code'],
  preferFrozen: true,
  allowMissingModes: false
});
const chunkMetaB = await loadChunkMeta(resolvedB.indexDirByMode.code, { strict: false });
assert.equal(chunkMetaB[0]?.end, 37, 'snapshot B should resolve its newer committed build root');
assert.notEqual(chunkMetaA[0]?.end ?? null, chunkMetaB[0]?.end ?? null, 'snapshot A and B should resolve distinct chunk metadata');

const latest = resolveIndexRef({
  ref: 'latest',
  repoRoot,
  userConfig,
  requestedModes: ['code'],
  preferFrozen: true,
  allowMissingModes: false
});
const latestChunkMeta = await loadChunkMeta(latest.indexDirByMode.code, { strict: false });
assert.equal(latest.canonical, 'latest', 'latest should remain the default as-of ref');
assert.equal(latestChunkMeta[0]?.end, chunkMetaB[0]?.end, 'latest should match the current build rather than an older snapshot');

console.log('snapshot query service test passed');

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
import { runSearchCli } from '../../src/retrieval/cli.js';

import { createBaseIndex } from '../indexing/validate/helpers.js';
import { ensureFixtureIndex } from '../helpers/fixture-index.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

const runSnapshotQueryCase = async () => {
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
  assert.equal(resolvedA.canonical, `snap:${snapshotA}`);
  assert.equal(resolvedA.identity?.snapshotId, snapshotA);
  const chunkMetaA = await loadChunkMeta(resolvedA.indexDirByMode.code, { strict: false });
  assert.equal(chunkMetaA[0]?.file, 'src/phase14-snapshot-query.js');
  assert.equal(chunkMetaA[0]?.end, 38);

  const activeBuildLock = await acquireIndexLock({
    repoCacheRoot,
    waitMs: 0,
    metadata: {
      owner: 'build-index',
      operation: 'stage4-promote'
    }
  });
  assert.ok(activeBuildLock);

  const resolvedAWhileLocked = resolveIndexRef({
    ref: `snap:${snapshotA}`,
    repoRoot,
    userConfig,
    requestedModes: ['code'],
    preferFrozen: true,
    allowMissingModes: false
  });
  const chunkMetaAWhileLocked = await loadChunkMeta(resolvedAWhileLocked.indexDirByMode.code, { strict: false });
  assert.equal(chunkMetaAWhileLocked[0]?.end, 38);
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
  assert.equal(chunkMetaB[0]?.end, 37);
  assert.notEqual(chunkMetaA[0]?.end ?? null, chunkMetaB[0]?.end ?? null);

  const latest = resolveIndexRef({
    ref: 'latest',
    repoRoot,
    userConfig,
    requestedModes: ['code'],
    preferFrozen: true,
    allowMissingModes: false
  });
  const latestChunkMeta = await loadChunkMeta(latest.indexDirByMode.code, { strict: false });
  assert.equal(latest.canonical, 'latest');
  assert.equal(latestChunkMeta[0]?.end, chunkMetaB[0]?.end);
};

const runExplicitRootNoFallbackCase = async () => {
  applyTestEnv();

  const root = process.cwd();
  const cacheName = 'asof-explicit-root-no-fallback';
  const cacheRoot = resolveTestCachePath(root, cacheName);
  await fs.rm(cacheRoot, { recursive: true, force: true });

  const { fixtureRoot } = await ensureFixtureIndex({
    fixtureName: 'sample',
    cacheName,
    cacheScope: 'shared'
  });
  const userConfig = loadUserConfig(fixtureRoot);
  const repoCacheRoot = getRepoCacheRoot(fixtureRoot, userConfig);

  const snapshotId = 'snap-20260212000000-nofb01';
  await createPointerSnapshot({
    repoRoot: fixtureRoot,
    userConfig,
    modes: ['code'],
    snapshotId
  });

  const snapshotPath = path.join(repoCacheRoot, 'snapshots', snapshotId, 'snapshot.json');
  const snapshotJson = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
  snapshotJson.pointer = snapshotJson.pointer || {};
  snapshotJson.pointer.buildRootsByMode = snapshotJson.pointer.buildRootsByMode || {};
  snapshotJson.pointer.buildRootsByMode.code = 'builds/missing-build-root';
  snapshotJson.pointer.buildRoot = 'builds/missing-build-root';
  await fs.writeFile(snapshotPath, `${JSON.stringify(snapshotJson, null, 2)}\n`, 'utf8');

  await assert.rejects(
    () => runSearchCli([
      '--repo',
      fixtureRoot,
      '--mode',
      'code',
      '--backend',
      'memory',
      '--json',
      '--compact',
      '--as-of',
      `snap:${snapshotId}`,
      '--',
      'return'
    ], { emitOutput: false, exitOnError: false }),
    /missing build root/i
  );

  const latest = await runSearchCli([
    '--repo',
    fixtureRoot,
    '--mode',
    'code',
    '--backend',
    'memory',
    '--json',
    '--compact',
    '--',
    'return'
  ], { emitOutput: false, exitOnError: false });

  assert.ok(Array.isArray(latest.code) && latest.code.length > 0);
};

await runSnapshotQueryCase();
await runExplicitRootNoFallbackCase();

console.log('snapshot ref contract matrix test passed');

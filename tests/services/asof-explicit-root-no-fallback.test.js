#!/usr/bin/env node
import { applyTestEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../helpers/fixture-index.js';
import { runSearchCli } from '../../src/retrieval/cli.js';
import { createPointerSnapshot } from '../../src/index/snapshots/create.js';
import { getRepoCacheRoot, loadUserConfig } from '../../tools/shared/dict-utils.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

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
  /missing build root/i,
  'explicit as-of snapshot should fail fast when its build root is missing'
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

assert.ok(Array.isArray(latest.code) && latest.code.length > 0, 'latest search should still succeed');

console.log('as-of explicit root no-fallback test passed');

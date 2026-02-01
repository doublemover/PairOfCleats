#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { loadUserConfig, getIndexDir } from '../../../tools/dict-utils.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { copyFixtureToTemp } from '../../helpers/fixtures.js';
import { repoRoot } from '../../helpers/root.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { syncProcessEnv } from '../../helpers/test-env.js';

const ROOT = repoRoot();
const BUILD_INDEX = path.join(ROOT, 'build_index.js');

const TEST_CONFIG = {
  sqlite: { enabled: false },
  indexing: {
    embeddings: { enabled: false },
    artifactCompression: { enabled: false },
    riskInterprocedural: { enabled: true }
  }
};

const buildOnce = async (fixtureRoot) => {
  const cacheRoot = await makeTempDir('pairofcleats-cache-call-sites-empty-');
  const env = {
    ...process.env,
    PAIROFCLEATS_TESTING: '1',
    PAIROFCLEATS_TEST_CONFIG: JSON.stringify(TEST_CONFIG),
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_EMBEDDINGS: 'stub',
    PAIROFCLEATS_WORKER_POOL: 'off'
  };

  const result = spawnSync(
    process.execPath,
    [BUILD_INDEX, '--stub-embeddings', '--repo', fixtureRoot, '--mode', 'code'],
    { cwd: fixtureRoot, env, encoding: 'utf8' }
  );

  if (result.status !== 0) {
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    assert.fail(`build_index.js failed with status ${result.status}`);
  }

  const prevEnv = {
    PAIROFCLEATS_TESTING: process.env.PAIROFCLEATS_TESTING,
    PAIROFCLEATS_TEST_CONFIG: process.env.PAIROFCLEATS_TEST_CONFIG,
    PAIROFCLEATS_CACHE_ROOT: process.env.PAIROFCLEATS_CACHE_ROOT,
    PAIROFCLEATS_EMBEDDINGS: process.env.PAIROFCLEATS_EMBEDDINGS
  };
  syncProcessEnv(env);
  try {
    const userConfig = loadUserConfig(fixtureRoot);
    const codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
    return { cacheRoot, codeDir };
  } finally {
    syncProcessEnv(prevEnv);
  }
};

const fixtureRoot = await copyFixtureToTemp('empty', {
  prefix: 'pairofcleats-call-sites-empty-'
});
const fixtureParent = path.dirname(fixtureRoot);
await fs.writeFile(
  path.join(fixtureRoot, 'index.js'),
  'const env = process.env.SECRET;\n',
  'utf8'
);

const cleanupDirs = [];
try {
  const { cacheRoot, codeDir } = await buildOnce(fixtureRoot);
  cleanupDirs.push(cacheRoot);

  const callSites = await loadJsonArrayArtifact(codeDir, 'call_sites', { strict: true });
  assert.ok(Array.isArray(callSites), 'call_sites should load as an array');
  assert.equal(callSites.length, 0, 'call_sites should be empty for call-free repo');

  console.log('call_sites empty required test passed');
} finally {
  for (const dir of cleanupDirs) {
    await rmDirRecursive(dir);
  }
  await rmDirRecursive(fixtureParent);
}

#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';

import { copyFixtureToTemp } from '../../helpers/fixtures.js';
import { resolveIndexDirFromBuildResult } from '../../helpers/index-build-output.js';
import { repoRoot } from '../../helpers/root.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const ROOT = repoRoot();
const BUILD_INDEX = path.join(ROOT, 'build_index.js');

const TEST_CONFIG = {
  sqlite: { enabled: false },
  indexing: {
    embeddings: { enabled: false },
    artifactCompression: { enabled: false }
  }
};

const readCallSiteLines = async (codeDir) => {
  const callSites = await loadJsonArrayArtifact(codeDir, 'call_sites', { strict: true });
  assert.ok(Array.isArray(callSites) && callSites.length > 0, 'fixture must emit call_sites rows');
  return callSites.map((row) => JSON.stringify(row));
};

const buildOnce = async (fixtureRoot, { label }) => {
  const cacheRoot = await makeTempDir(`pairofcleats-cache-${label}-`);

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: TEST_CONFIG,
    extraEnv: { PAIROFCLEATS_WORKER_POOL: 'off' }
  });

  const result = spawnSync(
    process.execPath,
    [BUILD_INDEX, '--stub-embeddings', '--stage', 'stage2', '--repo', fixtureRoot, '--mode', 'code'],
    { cwd: fixtureRoot, env, encoding: 'utf8' }
  );

  if (result.status !== 0) {
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    assert.fail(`build_index.js failed (${label}) with status ${result.status}`);
  }

  const userConfig = loadUserConfig(fixtureRoot);
  const codeDir = resolveIndexDirFromBuildResult(fixtureRoot, userConfig, result, { mode: 'code' });
  const lines = await readCallSiteLines(codeDir);
  return { cacheRoot, codeDir, lines };
};

const fixtureRoot = await copyFixtureToTemp('call-sites-determinism', { prefix: 'pairofcleats-determinism-' });
const fixtureParent = path.dirname(fixtureRoot);

const cleanupDirs = [];
try {
  const first = await buildOnce(fixtureRoot, { label: 'first' });
  cleanupDirs.push(first.cacheRoot);

  const second = await buildOnce(fixtureRoot, { label: 'second' });
  cleanupDirs.push(second.cacheRoot);

  assert.deepStrictEqual(
    first.lines,
    second.lines,
    'call_sites must be line-identical across clean rebuilds for a fixed fixture repo'
  );

  console.log('call_sites determinism test passed');
} finally {
  for (const dir of cleanupDirs) {
    await rmDirRecursive(dir);
  }
  await rmDirRecursive(fixtureParent);
}

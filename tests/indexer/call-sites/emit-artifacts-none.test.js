#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { copyFixtureToTemp } from '../../helpers/fixtures.js';
import { repoRoot } from '../../helpers/root.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveIndexDirFromBuildResult } from '../../helpers/index-build-output.js';
applyTestEnv();

const ROOT = repoRoot();
const BUILD_INDEX = path.join(ROOT, 'build_index.js');

const TEST_CONFIG = {
  sqlite: { enabled: false },
  indexing: {
    embeddings: { enabled: false },
    artifactCompression: { enabled: false },
    riskInterprocedural: { enabled: true, emitArtifacts: 'none' }
  }
};

const loadPieces = async (codeDir) => {
  const manifestPath = path.join(codeDir, 'pieces', 'manifest.json');
  const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const fields = raw?.fields && typeof raw.fields === 'object' ? raw.fields : raw;
  return Array.isArray(fields?.pieces) ? fields.pieces : [];
};

const buildOnce = async (fixtureRoot) => {
  const cacheRoot = await makeTempDir('pairofcleats-cache-call-sites-none-');
  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: TEST_CONFIG,
    extraEnv: {
      PAIROFCLEATS_WORKER_POOL: 'off'
    },
    syncProcess: false
  });

  const result = spawnSync(
    process.execPath,
    [BUILD_INDEX, '--stub-embeddings', '--repo', fixtureRoot, '--stage', 'stage2', '--mode', 'code'],
    { cwd: fixtureRoot, env, encoding: 'utf8' }
  );

  if (result.status !== 0) {
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    assert.fail(`build_index.js failed with status ${result.status}`);
  }

  const userConfig = loadUserConfig(fixtureRoot);
  const codeDir = resolveIndexDirFromBuildResult(fixtureRoot, userConfig, result, { mode: 'code' });
  return { cacheRoot, codeDir };
};

const fixtureRoot = await copyFixtureToTemp('call-sites-determinism', {
  prefix: 'pairofcleats-call-sites-none-'
});
const fixtureParent = path.dirname(fixtureRoot);

const cleanupDirs = [];
try {
  const { cacheRoot, codeDir } = await buildOnce(fixtureRoot);
  cleanupDirs.push(cacheRoot);

  const pieces = await loadPieces(codeDir);
  const names = pieces.map((piece) => piece?.name).filter(Boolean);

  assert.ok(!names.includes('call_sites'), 'call_sites should not be emitted when emitArtifacts=none');
  assert.ok(!names.includes('call_sites_meta'), 'call_sites_meta should not be emitted when emitArtifacts=none');

  console.log('call_sites emitArtifacts=none test passed');
} finally {
  for (const dir of cleanupDirs) {
    await rmDirRecursive(dir);
  }
  await rmDirRecursive(fixtureParent);
}

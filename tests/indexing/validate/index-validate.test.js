#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { repoRoot } from '../../helpers/root.js';
import { copyFixtureToTemp } from '../../helpers/fixtures.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = repoRoot();
const fixtureRoot = await copyFixtureToTemp('sample');
const fixtureTempRoot = path.dirname(fixtureRoot);
const cacheRoot = await makeTempDir('pairofcleats-index-validate-');
const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    sqlite: { use: false },
    indexing: {
      scm: { provider: 'none' },
      embeddings: { enabled: false }
    }
  }
});

const validatorPath = path.join(root, 'tools', 'index', 'validate.js');
const buildPath = path.join(root, 'build_index.js');

const missingResult = spawnSync(
  process.execPath,
  [validatorPath, '--repo', fixtureRoot, '--json'],
  { env, encoding: 'utf8' }
);
if (missingResult.status === 0) {
  console.error('Expected index-validate to fail when indexes are missing.');
  process.exit(1);
}

const buildResult = spawnSync(
  process.execPath,
  [buildPath, '--stub-embeddings', '--stage', 'stage2', '--mode', 'code', '--repo', fixtureRoot],
  { env, encoding: 'utf8' }
);
if (buildResult.status !== 0) {
  console.error('Failed to build fixture index for index-validate test.');
  if (buildResult.stderr) console.error(buildResult.stderr.trim());
  process.exit(buildResult.status ?? 1);
}
const userConfig = loadUserConfig(fixtureRoot);
const codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
const piecesPath = path.join(codeDir, 'pieces', 'manifest.json');
try {
  await fsPromises.access(piecesPath);
} catch {
  console.error('Expected pieces manifest to exist after build.');
  process.exit(1);
}

const okResult = spawnSync(
  process.execPath,
  [validatorPath, '--repo', fixtureRoot, '--json'],
  { env, encoding: 'utf8' }
);
if (okResult.status !== 0) {
  console.error('Expected index-validate to pass after building index.');
  if (okResult.stderr) console.error(okResult.stderr.trim());
  process.exit(okResult.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(okResult.stdout);
} catch {
  console.error('index-validate did not return valid JSON.');
  process.exit(1);
}
if (!payload || payload.ok !== true) {
  console.error('index-validate JSON payload missing ok=true.');
  process.exit(1);
}

console.log('index-validate test passed');

await rmDirRecursive(cacheRoot);
await rmDirRecursive(fixtureTempRoot);

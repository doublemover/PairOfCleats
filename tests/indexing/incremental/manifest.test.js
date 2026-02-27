#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoCacheRoot, loadUserConfig, toRealPathSync } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const root = process.cwd();
const tempRoot = await makeTempDir('pairofcleats-incremental-manifest-');
const repoRootRaw = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const buildIndexPath = path.join(root, 'build_index.js');

try {
  await fsPromises.mkdir(repoRootRaw, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  const repoRoot = toRealPathSync(repoRootRaw);

  const filePath = path.join(repoRoot, 'sample.js');
  await fsPromises.writeFile(filePath, 'export function hello() { return 1; }\n');

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: {
      indexing: {
        scm: { provider: 'none' }
      }
    }
  });

  const run = (args, label) => {
    const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, encoding: 'utf8' });
    if (result.status !== 0) {
      console.error(`Failed: ${label}`);
      if (result.stderr) console.error(result.stderr.trim());
      process.exit(result.status ?? 1);
    }
  };

  run([buildIndexPath, '--incremental', '--stub-embeddings', '--mode', 'code', '--repo', repoRoot], 'initial build');

  const userConfig = loadUserConfig(repoRoot);
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const manifestPath = path.join(repoCacheRoot, 'incremental', 'code', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('Missing incremental manifest after initial build.');
    process.exit(1);
  }

  const manifestBefore = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entryBefore = manifestBefore.files?.['sample.js'];
  if (!entryBefore) {
    console.error('Missing manifest entry for sample.js.');
    process.exit(1);
  }

  const newTime = new Date(Date.now() + 5000);
  fs.utimesSync(filePath, newTime, newTime);

  run([buildIndexPath, '--incremental', '--stub-embeddings', '--mode', 'code', '--repo', repoRoot], 'second build');

  const manifestAfter = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entryAfter = manifestAfter.files?.['sample.js'];
  if (!entryAfter) {
    console.error('Missing manifest entry after rebuild.');
    process.exit(1);
  }

  const statAfter = fs.statSync(filePath);
  if (entryAfter.mtimeMs !== statAfter.mtimeMs) {
    console.error(`Manifest mtimeMs not updated (${entryAfter.mtimeMs} vs ${statAfter.mtimeMs}).`);
    process.exit(1);
  }

  console.log('Incremental manifest refresh test passed');
} finally {
  await rmDirRecursive(tempRoot);
}


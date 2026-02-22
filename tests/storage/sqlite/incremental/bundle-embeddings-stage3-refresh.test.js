#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { getRepoCacheRoot } from '../../../../tools/shared/dict-utils.js';
import { setupIncrementalRepo } from '../../../helpers/sqlite-incremental.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';
import { getCombinedOutput } from '../../../helpers/stdio.js';

const { root, repoRoot, env, userConfig, run } = await setupIncrementalRepo({
  name: 'bundle-embeddings-stage3-refresh'
});

const buildIndexPath = path.join(root, 'build_index.js');

run(
  [
    buildIndexPath,
    '--incremental',
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--stage',
    'stage2',
    '--no-sqlite',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  'stage2 build',
  { cwd: repoRoot, env, stdio: 'inherit' }
);

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const manifestPath = path.join(repoCacheRoot, 'incremental', 'code', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('Expected incremental manifest after stage2 build.');
  process.exit(1);
}
const manifestStage2 = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifestStage2.bundleEmbeddings !== false) {
  console.error('Expected stage2 manifest to mark bundleEmbeddings=false.');
  process.exit(1);
}

run(
  [
    buildIndexPath,
    '--incremental',
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--stage',
    'stage3',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  'stage3 build',
  { cwd: repoRoot, env, stdio: 'inherit' }
);

const manifestStage3 = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifestStage3.bundleEmbeddings !== true) {
  console.error('Expected stage3 manifest to mark bundleEmbeddings=true.');
  process.exit(1);
}
if (manifestStage3.bundleEmbeddingStage !== 'stage3') {
  console.error('Expected stage3 manifest to mark bundleEmbeddingStage=stage3.');
  process.exit(1);
}

const sqliteLogs = [];
await runSqliteBuild(repoRoot, {
  mode: 'code',
  incremental: true,
  logger: {
    log: (message) => sqliteLogs.push(message),
    warn: (message) => sqliteLogs.push(message),
    error: (message) => sqliteLogs.push(message)
  }
});

const output = getCombinedOutput({ stdout: sqliteLogs.join('\n'), stderr: '' });
if (!output.includes('Using incremental bundles for code')) {
  console.error('Expected sqlite incremental build to use incremental bundles.');
  process.exit(1);
}
const outputLower = output.toLowerCase();
if (
  outputLower.includes('incremental bundles skipped')
  || outputLower.includes('falling back to artifacts')
) {
  console.error('Did not expect sqlite incremental bundle fallback after stage3 refresh.');
  process.exit(1);
}

console.log('SQLite incremental bundle embeddings stage3 refresh ok.');

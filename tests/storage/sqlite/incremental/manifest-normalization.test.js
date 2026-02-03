#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getRepoCacheRoot } from '../../../../tools/dict-utils.js';
import { setupIncrementalRepo } from '../../../helpers/sqlite-incremental.js';
import { getCombinedOutput } from '../../../helpers/stdio.js';

const { root, repoRoot, env, userConfig, run, runCapture } = await setupIncrementalRepo({
  name: 'manifest-normalization'
});

run(
  [path.join(root, 'build_index.js'), '--incremental', '--stub-embeddings', '--repo', repoRoot],
  'build index',
  { cwd: repoRoot, env, stdio: 'inherit' }
);
run(
  [path.join(root, 'tools', 'build/sqlite-index.js'), '--repo', repoRoot],
  'build sqlite index',
  { cwd: repoRoot, env, stdio: 'inherit' }
);

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const manifestPath = path.join(repoCacheRoot, 'incremental', 'code', 'manifest.json');
let manifest = null;
try {
  manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
} catch {
  console.error('Failed to load incremental manifest for normalization test.');
  process.exit(1);
}
if (!manifest?.files?.['src/index.js']) {
  console.error('Expected manifest entry for src/index.js.');
  process.exit(1);
}
manifest.files['src\\index.js'] = manifest.files['src/index.js'];
delete manifest.files['src/index.js'];
await fsPromises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const normalizedResult = runCapture(
  [path.join(root, 'tools', 'build/sqlite-index.js'), '--incremental', '--repo', repoRoot],
  'build sqlite index (normalized manifest)'
);
const normalizedOutput = getCombinedOutput(normalizedResult);
if (!normalizedOutput.includes('SQLite Indexes Updated') && !normalizedOutput.includes('SQLite Index Updated')) {
  console.error('Expected incremental sqlite update with normalized manifest.');
  process.exit(1);
}

console.log('SQLite incremental manifest normalization ok.');

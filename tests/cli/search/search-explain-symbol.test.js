#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { makeTempDir } from '../../helpers/temp.js';

const root = process.cwd();
const tempRoot = await makeTempDir('pairofcleats-explain-symbol-');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'symbol.js'),
  'export function boostExample() { return "symbol boost test"; }\n'
);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('Failed: build_index');
  process.exit(buildResult.status ?? 1);
}

const searchResult = spawnSync(
  process.execPath,
  [
    path.join(root, 'search.js'),
    'boostExample',
    '--mode',
    'code',
    '--explain',
    '--no-ann',
    '--repo',
    repoRoot
  ],
  { encoding: 'utf8', env }
);
if (searchResult.status !== 0) {
  console.error('Search failed.');
  if (searchResult.stderr) console.error(searchResult.stderr.trim());
  process.exit(searchResult.status ?? 1);
}

const output = getCombinedOutput(searchResult);
if (!output.includes('Symbol')) {
  console.error('Expected explain output to include symbol boost details.');
  process.exit(1);
}

console.log('explain symbol test passed');


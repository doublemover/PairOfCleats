#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'build-embeddings-explicit-index-root-failfast');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const explicitIndexRoot = path.join(tempRoot, 'explicit-index-root-missing-mode');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.mkdir(cacheRoot, { recursive: true });
await fs.mkdir(explicitIndexRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'src', 'alpha.js'), 'export const alpha = 1;\n', 'utf8');

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      embeddings: {
        hnsw: { enabled: false },
        lancedb: { enabled: false }
      }
    }
  }
});

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'build/embeddings.js'),
    '--repo', repoRoot,
    '--mode', 'prose',
    '--stub-embeddings',
    '--index-root', explicitIndexRoot
  ],
  {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    stdio: 'pipe'
  }
);

assert.notEqual(result.status, 0, 'expected build-embeddings to fail for missing mode artifacts under explicit --index-root');
const output = `${result.stdout || ''}\n${result.stderr || ''}`;
assert.match(
  output,
  /Missing index artifacts for mode "prose" under explicit --index-root/i,
  'expected explicit index-root missing mode fail-fast message'
);

console.log('build-embeddings explicit index-root fail-fast test passed');

#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'code-map-graphviz');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'a.js'),
  'export function alpha() { return 1; }\n'
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: build index for graphviz fallback test');
  process.exit(buildResult.status ?? 1);
}

const outPath = path.join(tempRoot, 'map.svg');
const mapResult = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'reports/report-code-map.js'),
    '--format', 'svg',
    '--repo', repoRoot,
    '--out', outPath,
    '--json'
  ],
  {
    cwd: repoRoot,
    env: {
      ...env,
      PATH: '',
      Path: ''
    },
    encoding: 'utf8'
  }
);

if (mapResult.status !== 0) {
  console.error('Failed: graphviz fallback map output');
  process.exit(mapResult.status ?? 1);
}

const payload = JSON.parse(mapResult.stdout || '{}');
if (payload.format !== 'dot') {
  console.error('Failed: expected dot fallback');
  process.exit(1);
}
if (!payload.outPath || !payload.outPath.endsWith('.dot')) {
  console.error('Failed: expected .dot output path');
  process.exit(1);
}

console.log('code map graphviz fallback tests passed');


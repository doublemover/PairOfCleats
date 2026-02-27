#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'code-map-dot');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'a.js'),
  'import { add } from "./b.js";\n' +
    'export function run(x) { return add(x, 1); }\n'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'b.js'),
  'export function add(a, b) { return a + b; }\n'
);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      embeddings: { enabled: false },
      typeInference: false,
      typeInferenceCrossFile: false,
      treeSitter: {
        deferMissing: false
      }
    },
    tooling: {
      autoEnableOnDetect: false
    }
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: build index for code map dot test');
  process.exit(buildResult.status ?? 1);
}

const mapResult = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'reports/report-code-map.js'),
    '--format',
    'dot',
    '--include',
    'imports,calls',
    '--repo',
    repoRoot
  ],
  { cwd: repoRoot, env, encoding: 'utf8' }
);

if (mapResult.status !== 0) {
  console.error('Failed: map dot output');
  process.exit(mapResult.status ?? 1);
}

const output = getCombinedOutput(mapResult);
if (!output.includes('PORT=')) {
  console.error('Failed: dot output missing ports');
  process.exit(1);
}
if (!output.includes('->')) {
  console.error('Failed: dot output missing edges');
  process.exit(1);
}
if (!output.includes('style="dashed"')) {
  console.error('Failed: dot output missing import style');
  process.exit(1);
}

console.log('code map dot tests passed');


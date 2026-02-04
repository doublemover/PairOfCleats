#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../helpers/test-env.js';
import { getIndexDir, resolveRepoConfig } from '../../tools/shared/dict-utils.js';
import { buildCodeMap } from '../../src/map/build-map.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'map-build-heap-guard');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'alpha.js'),
  'export function alpha() { return 1; }\n'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'beta.js'),
  'import { alpha } from "./alpha.js";\nexport function beta() { return alpha(); }\n'
);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: build index for map heap guard test');
  process.exit(buildResult.status ?? 1);
}

const { userConfig } = resolveRepoConfig(repoRoot);
const indexDir = getIndexDir(repoRoot, 'code', userConfig, {});

let threw = false;
try {
  await buildCodeMap({
    repoRoot,
    indexDir,
    options: {
      mode: 'code',
      maxEdgeBytes: 10
    }
  });
} catch (err) {
  threw = true;
  const message = err?.message || String(err);
  if (!message.includes('max-edge-bytes') && !message.includes('edges')) {
    console.error(`Failed: unexpected guardrail message: ${message}`);
    process.exit(1);
  }
}

if (!threw) {
  console.error('Failed: expected guardrail to throw for edges');
  process.exit(1);
}

console.log('map build heap guard test passed');

#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'search-ann-rrf-contract');
const cacheRoot = path.join(tempRoot, 'cache');
const fixtureRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.writeFile(
  path.join(fixtureRoot, 'src', 'greet.js'),
  [
    'export function greet(name = "world") {',
    '  return `hello ${name}`;',
    '}',
    ''
  ].join('\n')
);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      embeddings: {
        hnsw: {
          enabled: true,
          isolate: false
        }
      },
      scm: { provider: 'none' },
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  },
  extraEnv: {
    PAIROFCLEATS_WORKER_POOL: 'off'
  }
});

runNode(
  [
    path.join(root, 'build_index.js'),
    '--stub-embeddings',
    '--stage',
    'stage1',
    '--mode',
    'code',
    '--no-sqlite',
    '--scm-provider',
    'none',
    '--repo',
    fixtureRoot
  ],
  'search ann rrf contract build',
  root,
  env,
  { stdio: 'inherit' }
);

runNode(
  [
    path.join(root, 'tools', 'build', 'embeddings.js'),
    '--stub-embeddings',
    '--mode',
    'code',
    '--repo',
    fixtureRoot
  ],
  'search ann rrf contract embeddings',
  root,
  env,
  { stdio: 'inherit' }
);

const result = runNode(
  [
    path.join(root, 'search.js'),
    'greet',
    '--mode',
    'code',
    '--backend',
    'memory',
    '--ann',
    '--ann-backend',
    'hnsw',
    '--json',
    '--stats',
    '--explain',
    '--repo',
    fixtureRoot
  ],
  'search ann rrf contract',
  root,
  env,
  { stdio: 'pipe' }
);

let payload = null;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch {
  throw new Error('search ann rrf contract returned invalid JSON');
}

const hit = payload?.code?.[0];
if (!payload?.stats?.annActive) {
  throw new Error('expected annActive to be true');
}
if (!hit?.scoreBreakdown?.rrf) {
  throw new Error('expected scoreBreakdown.rrf');
}
if (hit.scoreType !== 'rrf') {
  throw new Error(`expected scoreType=rrf, got ${hit.scoreType}`);
}

console.log('search ann rrf contract test passed');

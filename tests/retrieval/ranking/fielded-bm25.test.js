#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'fielded-bm25');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
const fixtureRoot = path.join(tempRoot, 'repo');
await fsPromises.mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.writeFile(
  path.join(fixtureRoot, 'src', 'greet.js'),
  [
    'export function greet(name = "world") {',
    '  return `greet ${name}`;',
    '}',
    ''
  ].join('\n')
);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
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
    '--repo',
    fixtureRoot,
    '--stage',
    'stage1',
    '--mode',
    'code',
    '--no-sqlite',
    '--scm-provider',
    'none'
  ],
  'fielded bm25 build index',
  root,
  env,
  { stdio: 'inherit' }
);

const userConfig = loadUserConfig(fixtureRoot);
const fieldPostings = path.join(
  getIndexDir(fixtureRoot, 'code', userConfig),
  'field_postings.json'
);

if (!fs.existsSync(fieldPostings)) {
  console.error('fielded bm25 test failed: field_postings.json missing');
  process.exit(1);
}

const result = runNode(
  [
    path.join(root, 'search.js'),
    'greet',
    '--mode',
    'code',
    '--no-ann',
    '--backend',
    'memory',
    '--explain',
    '--json',
    '--repo',
    fixtureRoot
  ],
  'fielded bm25 search',
  root,
  env,
  { stdio: 'pipe' }
);

let payload = null;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch (err) {
  console.error('fielded bm25 test failed: invalid JSON output');
  process.exit(1);
}

const hit = payload?.code?.[0];
if (!hit) {
  console.error('fielded bm25 test failed: no hits');
  process.exit(1);
}
if (hit.scoreType !== 'bm25-fielded') {
  console.error(`fielded bm25 test failed: expected bm25-fielded, got ${hit.scoreType}`);
  process.exit(1);
}
if (hit.scoreBreakdown?.sparse?.fielded !== true) {
  console.error('fielded bm25 test failed: sparse.fielded not true');
  process.exit(1);
}

console.log('fielded bm25 tests passed');


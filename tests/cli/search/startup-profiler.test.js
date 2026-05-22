#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'search-startup-profiler');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'export const alpha = "alpha beta gamma";\n');

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
    '--stage',
    'stage1',
    '--mode',
    'code',
    '--no-sqlite',
    '--scm-provider',
    'none',
    '--repo',
    repoRoot
  ],
  'search startup profiler build index',
  repoRoot,
  env,
  { stdio: 'inherit' }
);

const searchArgs = [
  path.join(root, 'search.js'),
  'alpha',
  '--mode',
  'code',
  '--json',
  '--stats',
  '--backend',
  'memory',
  '--no-ann',
  '--repo',
  repoRoot
];

const result = runNode(searchArgs, 'search startup profiler', repoRoot, env, {
  stdio: 'pipe'
});

let payload;
try {
  payload = JSON.parse(result.stdout || '{}');
} catch {
  console.error('Failed: search startup profiler returned invalid JSON');
  process.exit(1);
}

const pipeline = payload?.stats?.pipeline;
if (!Array.isArray(pipeline) || pipeline.length === 0) {
  console.error('Expected startup pipeline stats to be present.');
  process.exit(1);
}

const stages = new Set(pipeline.map((entry) => entry.stage));
if (!stages.has('startup.backend') || !stages.has('startup.search')) {
  console.error('Expected startup backend/search stages in pipeline stats.');
  process.exit(1);
}

const orderedStages = pipeline.map((entry) => entry.stage);
const indexOf = (name) => orderedStages.indexOf(name);
if (indexOf('startup.backend') < 0) {
  console.error('Expected startup.backend stage in pipeline stats.');
  process.exit(1);
}
if (indexOf('startup.dictionary') < 0) {
  console.error('Expected startup.dictionary stage in pipeline stats.');
  process.exit(1);
}
if (indexOf('startup.query-plan') < 0) {
  console.error('Expected startup.query-plan stage in pipeline stats.');
  process.exit(1);
}
if (indexOf('startup.indexes') < 0) {
  console.error('Expected startup.indexes stage in pipeline stats.');
  process.exit(1);
}
if (!(indexOf('startup.backend') < indexOf('startup.dictionary'))) {
  console.error('Expected startup.backend to precede startup.dictionary.');
  process.exit(1);
}
if (!(indexOf('startup.dictionary') < indexOf('startup.query-plan'))) {
  console.error('Expected startup.dictionary to precede startup.query-plan.');
  process.exit(1);
}
if (!(indexOf('startup.query-plan') < indexOf('startup.indexes'))) {
  console.error('Expected startup.query-plan to precede startup.indexes.');
  process.exit(1);
}
if (!(indexOf('startup.indexes') < indexOf('startup.search'))) {
  console.error('Expected startup.indexes to precede startup.search.');
  process.exit(1);
}
if (indexOf('filter') >= 0 && !(indexOf('startup.indexes') < indexOf('filter'))) {
  console.error('Expected startup.indexes to precede filter.');
  process.exit(1);
}

console.log('search startup profiler test passed');

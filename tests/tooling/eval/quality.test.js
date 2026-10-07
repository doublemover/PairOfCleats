#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'eval-quality');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const datasetPath = path.join(tempRoot, 'eval-code-only.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'index.js'),
  [
    'export function greet(name) {',
    '  return `hello ${name}`;',
    '}',
    '',
    'export function sum(left, right) {',
    '  return left + right;',
    '}',
    ''
  ].join('\n')
);
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'util.js'),
  [
    'export function clamp(value, min, max) {',
    '  return Math.max(min, Math.min(max, value));',
    '}',
    ''
  ].join('\n')
);
const codeOnlyDataset = [
  { query: 'greet', mode: 'code', expect: [{ file: 'src/index.js', name: 'greet' }] },
  { query: 'sum', mode: 'code', expect: [{ file: 'src/index.js', name: 'sum' }] },
  { query: 'clamp', mode: 'code', expect: [{ file: 'src/util.js', name: 'clamp' }] }
];
await fsPromises.writeFile(datasetPath, JSON.stringify(codeOnlyDataset, null, 2));

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false,
      workerPool: { enabled: false }
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  },
  syncProcess: false
});

const buildResult = runNode(
  [
    path.join(root, 'build_index.js'),
    '--stub-embeddings',
    '--stage',
    'stage1',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  'eval quality build',
  repoRoot,
  env,
  { stdio: 'inherit', allowFailure: true }
);
if (buildResult.status !== 0) {
  console.error('eval quality test failed: build_index failed');
  process.exit(buildResult.status ?? 1);
}

const evalResult = runNode(
  [
    path.join(root, 'tools', 'eval', 'run.js'),
    '--repo',
    repoRoot,
    '--dataset',
    datasetPath,
    '--backend',
    'memory',
    '--no-ann',
    '--top',
    '5'
  ],
  'eval quality run',
  root,
  env,
  { stdio: 'pipe', allowFailure: true }
);

if (evalResult.status !== 0) {
  console.error('eval quality test failed: eval run returned error');
  if (evalResult.stderr) console.error(evalResult.stderr.trim());
  process.exit(evalResult.status ?? 1);
}

let payload = null;
try {
  payload = JSON.parse(evalResult.stdout || '{}');
} catch (err) {
  console.error('eval quality test failed: invalid JSON output');
  process.exit(1);
}

const summary = payload?.summary || {};
const recallAt5 = summary?.recallAtK?.['5'] ?? 0;
const ndcgAt5 = summary?.ndcgAtK?.['5'] ?? 0;
const mrr = summary?.mrr ?? 0;

if (recallAt5 < 0.6) {
  console.error(`eval quality test failed: recall@5 too low (${recallAt5.toFixed(3)})`);
  process.exit(1);
}
if (ndcgAt5 < 0.6) {
  console.error(`eval quality test failed: ndcg@5 too low (${ndcgAt5.toFixed(3)})`);
  process.exit(1);
}
if (mrr < 0.5) {
  console.error(`eval quality test failed: mrr too low (${mrr.toFixed(3)})`);
  process.exit(1);
}

console.log('eval quality tests passed');


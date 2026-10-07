#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { runNode as runNodeHelper } from '../helpers/run-node.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { cleanup, root } from './smoke-utils.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

const tempRoot = resolveTestCachePath(root, 'smoke-retrieval');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const searchPath = path.join(root, 'search.js');

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
  },
  syncProcess: false
});

const fail = (message, exitCode = 1) => {
  const error = new Error(message);
  error.exitCode = exitCode;
  throw error;
};

const runNode = (label, args, options = {}) => {
  const {
    cwd = root,
    stdio = 'pipe',
    timeout,
    ...spawnOptions
  } = options;
  const result = runNodeHelper(args, label, cwd, env, {
    stdio,
    timeoutMs: timeout,
    allowFailure: true,
    spawnOptions
  });
  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.trim() : '';
    if (stderr) console.error(stderr);
    fail(`Failed: ${label}`, result.status ?? 1);
  }
  return result;
};

let failure = null;
try {
  await cleanup([tempRoot]);
  await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'alpha.js'),
    'export function returnSmokeValue() { return "return smoke token"; }\n'
  );

  const build = runNode(
    'build index',
    [
      path.join(root, 'build_index.js'),
      '--stub-embeddings',
      '--stage',
      'stage1',
      '--mode',
      'code',
      '--repo',
      repoRoot,
      '--no-sqlite'
    ],
    { stdio: 'inherit' }
  );
  if (build.status !== 0) {
    fail('smoke retrieval failed: build_index failed', build.status ?? 1);
  }

  const annResult = runNode(
    'search ann',
    [
      searchPath,
      'return smoke token',
      '--mode',
      'code',
      '--ann',
      '--json',
      '--stats',
      '--explain',
      '--repo',
      repoRoot
    ]
  );
  let annPayload = null;
  try {
    annPayload = JSON.parse(annResult.stdout || '{}');
  } catch {
    fail('search ann test failed: invalid JSON output');
  }
  if (!annPayload?.stats?.annActive) {
    fail('search ann test failed: annActive was false');
  }
  const annHit = annPayload?.code?.find((hit) => hit?.scoreBreakdown?.ann);
  if (!annHit) {
    fail('search ann test failed: no ann hits found');
  }
  const annSource = annHit?.scoreBreakdown?.ann?.source;
  if (!annSource) {
    fail('search ann test failed: ann source missing');
  }

  const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*m/g, '');
  const explainResult = runNode(
    'search explain',
    [searchPath, 'return smoke token', '--mode', 'code', '--no-ann', '--repo', repoRoot, '--explain']
  );
  const explainOutput = stripAnsi(`${explainResult.stdout || ''}\n${explainResult.stderr || ''}`);
  if (!/score/i.test(explainOutput)) {
    fail('Explain output missing score details.');
  }
  if (!/sparse|bm25/i.test(explainOutput)) {
    fail('Explain output missing sparse/bm25 details.');
  }

} catch (err) {
  console.error(err?.message || err);
  failure = err;
}

await cleanup([tempRoot]);
if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke retrieval passed');


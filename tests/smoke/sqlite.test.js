#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { cleanup, root } from './smoke-utils.js';
import { runSqliteBuild } from '../helpers/sqlite-builder.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

const tempRoot = resolveTestCachePath(root, 'smoke-sqlite');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false,
      scm: { provider: 'none' }
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  }
});

const fail = (message, exitCode = 1) => {
  const error = new Error(message);
  error.exitCode = exitCode;
  throw error;
};

const run = (label, args, options = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    ...options
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    if (stderr) console.error(stderr);
    if (stdout) console.error(stdout);
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
    'export const alpha = () => "sqlite_smoke_token";\n'
  );

  run('build_index', [
    path.join(root, 'build_index.js'),
    '--stub-embeddings',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ]);
  await runSqliteBuild(repoRoot, { mode: 'code', env });

  const searchResult = run('search sqlite backend', [
    path.join(root, 'search.js'),
    'sqlite_smoke_token',
    '--mode',
    'code',
    '--backend',
    'sqlite',
    '--json',
    '--repo',
    repoRoot
  ]);

  const payload = JSON.parse(searchResult.stdout || '{}');
  const hits = Array.isArray(payload?.code) ? payload.code : [];
  assert.ok(hits.length > 0, 'expected sqlite smoke search to return at least one code hit');
  assert.ok(
    hits.some((hit) => String(hit?.file || '').includes('src/alpha.js')),
    'expected sqlite smoke search to return src/alpha.js'
  );
} catch (err) {
  console.error(err?.message || err);
  failure = err;
}
await cleanup([tempRoot]);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke sqlite passed');


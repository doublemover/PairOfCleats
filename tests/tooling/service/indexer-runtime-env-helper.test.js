#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createServiceRuntimeEnvResolver,
  logThreadpoolInfo,
  normalizeRuntimeConfigCacheKey,
  readRepoConfigMtime
} from '../../../tools/service/indexer-service-helpers.js';

const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-indexer-runtime-env-'));
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  runtime: {
    uvThreadpoolSize: 7,
    nodeOptions: '--trace-warnings',
    maxOldSpaceMb: 768
  }
}), 'utf8');

const cacheKey = normalizeRuntimeConfigCacheKey(repoRoot);
assert.equal(
  cacheKey,
  process.platform === 'win32' ? path.resolve(repoRoot).toLowerCase() : path.resolve(repoRoot)
);

const mtime = readRepoConfigMtime(repoRoot);
assert.equal(mtime.configPath, path.join(repoRoot, '.pairofcleats.json'));
assert.equal(Number.isFinite(mtime.mtimeMs), true);

const resolver = createServiceRuntimeEnvResolver({
  baseEnv: {
    PATH: 'test-path'
  }
});
const runtimeEnv = resolver.resolveRepoRuntimeEnv(repoRoot);
assert.equal(runtimeEnv.PATH, 'test-path');
assert.equal(runtimeEnv.UV_THREADPOOL_SIZE, '7');

const overriddenEnv = resolver.resolveRepoRuntimeEnv(repoRoot, {
  UV_THREADPOOL_SIZE: '3',
  NODE_OPTIONS: '--enable-source-maps',
  POC_RUNTIME_MARKER: 'extra'
});
assert.equal(overriddenEnv.UV_THREADPOOL_SIZE, '7');
assert.equal(overriddenEnv.POC_RUNTIME_MARKER, 'extra');

const errors = [];
const originalError = console.error;
console.error = (line) => {
  errors.push(String(line));
};
try {
  logThreadpoolInfo(repoRoot, 'indexer-test', {
    UV_THREADPOOL_SIZE: '7'
  });
} finally {
  console.error = originalError;
}
assert.ok(
  errors.some((line) => line.includes('[indexer-test] UV_THREADPOOL_SIZE=7')),
  'expected service threadpool diagnostics to report the effective UV threadpool size'
);

console.log('indexer runtime env helper test passed');

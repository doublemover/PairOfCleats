#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import { buildIndex, search, status } from '../../src/integrations/core/index.js';
import { createApiRouter } from '../../tools/api/router.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
import { cleanup, root } from './smoke-utils.js';

const cacheRoots = [
  resolveTestCachePath(root, 'core-api'),
  resolveTestCachePath(root, 'api-router')
];

const normalizePathForCompare = (value) => {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const writeCoreFixture = async (repoRoot) => {
  await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', 'index.js'),
    'export function greet(name = "world") { return `hello ${name}`; }\n',
    'utf8'
  );
  await fsPromises.writeFile(
    path.join(repoRoot, 'README.md'),
    '# Core API smoke fixture\n\nsmall synthetic repo\n',
    'utf8'
  );
};

const runCoreSmoke = async () => {
  const cacheRoot = resolveTestCachePath(root, 'core-api');
  const repoRoot = path.join(cacheRoot, 'repo');
  await fsPromises.rm(cacheRoot, { recursive: true, force: true });
  await fsPromises.mkdir(repoRoot, { recursive: true });
  await writeCoreFixture(repoRoot);

  const previousCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
  const previousEmbeddings = process.env.PAIROFCLEATS_EMBEDDINGS;
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
        embeddings: {
          enabled: false,
          mode: 'off'
        }
      },
      tooling: {
        autoEnableOnDetect: false,
        lsp: { enabled: false }
      }
    },
    syncProcess: false,
    extraEnv: {
      PAIROFCLEATS_WORKER_POOL: 'off'
    }
  });
  process.env.PAIROFCLEATS_CACHE_ROOT = env.PAIROFCLEATS_CACHE_ROOT;
  process.env.PAIROFCLEATS_EMBEDDINGS = env.PAIROFCLEATS_EMBEDDINGS;
  try {
    await buildIndex(repoRoot, {
      stage: 'stage1',
      mode: 'code',
      sqlite: false,
      stubEmbeddings: true,
      scmProvider: 'none',
      log: () => {}
    });

    const searchPayload = await search(repoRoot, { query: 'greet', mode: 'code', json: true });
    assert.ok(Array.isArray(searchPayload.code) && searchPayload.code.length > 0);

    const statusPayload = await status(repoRoot);
    assert.equal(normalizePathForCompare(statusPayload?.repo?.root), normalizePathForCompare(repoRoot));
  } finally {
    if (previousCacheRoot == null) {
      delete process.env.PAIROFCLEATS_CACHE_ROOT;
    } else {
      process.env.PAIROFCLEATS_CACHE_ROOT = previousCacheRoot;
    }
    if (previousEmbeddings == null) {
      delete process.env.PAIROFCLEATS_EMBEDDINGS;
    } else {
      process.env.PAIROFCLEATS_EMBEDDINGS = previousEmbeddings;
    }
  }
};

const runRouterSmoke = async () => {
  const tempRoot = resolveTestCachePath(root, 'api-router');
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(tempRoot, { recursive: true });

  const router = createApiRouter({
    host: '127.0.0.1',
    defaultRepo: tempRoot,
    defaultOutput: 'json',
    metricsRegistry: null
  });

  const server = http.createServer((req, res) => router.handleRequest(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/missing`);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.ok(payload.hint);
  } finally {
    server.close();
    if (typeof router.close === 'function') router.close();
  }
};

let failure = null;
try {
  await cleanup(cacheRoots);
  await runCoreSmoke();
  await runRouterSmoke();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  failure = error;
}
await cleanup(cacheRoots);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke api-core-health passed');

#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { startApiServer } from '../../helpers/api-server.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = resolveTestCachePath(root, 'subprocess-quoting');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

// Create a repo path containing spaces to catch quoting/arg-parsing bugs.
const repoParent = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats repo with spaces '));
const repoPath = path.join(repoParent, 'sample repo');
await fsPromises.cp(fixtureRoot, repoPath, { recursive: true });

const env = {
  ...applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    syncProcess: false
  }),
  PAIROFCLEATS_CACHE_ROOT: cacheRoot
};

const build = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoPath],
  { env, stdio: 'inherit' }
);
if (build.status !== 0) {
  console.error('subprocess-quoting test failed: build_index failed');
  process.exit(1);
}

let serverInfo = null;
let stopServer = null;
let requestJson = null;
try {
  const started = await startApiServer({
    repoRoot: repoPath,
    env
  });
  serverInfo = started.serverInfo;
  stopServer = started.stop;
  requestJson = started.requestJson;
  if (!serverInfo?.baseUrl) {
    throw new Error('api-server did not report a baseUrl');
  }

  const health = await requestJson('GET', '/health', null, serverInfo);
  if (!health.body?.ok) {
    throw new Error('api-server /health failed');
  }

  const status = await requestJson('GET', '/status', null, serverInfo);
  if (!status.body?.ok || !status.body?.status) {
    throw new Error('api-server /status failed');
  }

  const search = await requestJson('POST', '/search', {
    repoPath,
    query: 'return',
    mode: 'code',
    top: 10
  }, serverInfo);
  if (!search.body?.ok || !Array.isArray(search.body?.result?.code) || !search.body.result.code.length) {
    throw new Error('api-server /search returned no results');
  }
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  if (typeof stopServer === 'function') {
    await stopServer();
  }
}

console.log('subprocess-quoting: ok');


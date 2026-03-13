#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'indexer-service-sync-failure');
const configPath = path.join(tempRoot, 'service.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const config = {
  queueDir: path.join(tempRoot, 'queue'),
  repos: [
    { id: 'missing-url-repo', path: path.join(tempRoot, 'missing-repo') }
  ]
};
await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));

const run = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'service', 'indexer-service.js'), 'sync', '--config', configPath, '--json'],
  { encoding: 'utf8' }
);

assert.equal(run.status, 1, `expected sync failures to exit 1, got ${run.status}`);
const payload = JSON.parse(run.stdout || '{}');
assert.equal(payload?.ok, false, 'expected sync payload ok=false on repo failures');
assert.equal(Array.isArray(payload?.results), true, 'expected sync payload results array');
assert.equal(payload.results[0]?.id, 'missing-url-repo');
assert.equal(payload.results[0]?.ok, false);
assert.match(String(payload.results[0]?.message || ''), /Missing repo url/i);

console.log('indexer service sync failure-exit test passed');

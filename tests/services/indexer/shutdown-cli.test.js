#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'indexer-service-shutdown-cli');
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const configPath = path.join(tempRoot, 'service.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

await fsPromises.writeFile(configPath, JSON.stringify({
  queueDir,
  repos: [
    { id: 'repo', path: repoRoot, syncPolicy: 'none' }
  ]
}, null, 2));

const runCli = (...args) => spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'service', 'indexer-service.js'), ...args],
  { encoding: 'utf8' }
);

const shutdown = runCli('shutdown', '--config', configPath, '--shutdown-mode', 'stop-accepting', '--json');
assert.equal(shutdown.status, 0, shutdown.stderr || shutdown.stdout);
const shutdownPayload = JSON.parse(shutdown.stdout || '{}');
assert.equal(shutdownPayload.shutdown?.mode, 'stop-accepting');
assert.equal(shutdownPayload.shutdown?.accepting, false);

const statusBlocked = runCli('status', '--config', configPath, '--json');
assert.equal(statusBlocked.status, 0, statusBlocked.stderr || statusBlocked.stdout);
const statusPayload = JSON.parse(statusBlocked.stdout || '{}');
assert.equal(statusPayload.shutdown?.mode, 'stop-accepting');
assert.equal(statusPayload.shutdown?.accepting, false);

const blockedEnqueue = runCli('enqueue', '--config', configPath, '--repo', repoRoot, '--mode', 'code', '--json');
assert.notEqual(blockedEnqueue.status, 0, 'enqueue should fail while stop-accepting is active');
const blockedPayload = JSON.parse(blockedEnqueue.stdout || '{}');
assert.equal(blockedPayload.code, 'SERVICE_STOP_ACCEPTING');
assert.equal(blockedPayload.shutdown?.mode, 'stop-accepting');

const resumed = runCli('resume', '--config', configPath, '--json');
assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
const resumedPayload = JSON.parse(resumed.stdout || '{}');
assert.equal(resumedPayload.shutdown?.mode, 'running');
assert.equal(resumedPayload.shutdown?.accepting, true);

const enqueue = runCli('enqueue', '--config', configPath, '--repo', repoRoot, '--mode', 'code', '--json');
assert.equal(enqueue.status, 0, enqueue.stderr || enqueue.stdout);
const enqueuePayload = JSON.parse(enqueue.stdout || '{}');
assert.equal(enqueuePayload.ok, true);

console.log('indexer service shutdown cli test passed');

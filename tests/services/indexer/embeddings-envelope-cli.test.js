#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'indexer-service-embeddings-envelope');
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const configPath = path.join(tempRoot, 'service.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

await fsPromises.writeFile(configPath, JSON.stringify({
  queueDir,
  queue: {
    maxRetries: 2,
    maxQueued: 20,
    maxRunning: 1,
    resourceBudgetUnits: 4
  },
  worker: {
    concurrency: 1
  },
  embeddings: {
    queue: {
      maxRetries: 5,
      maxQueued: 3,
      maxRunning: 2,
      resourceBudgetUnits: 12
    },
    worker: {
      concurrency: 2,
      maxMemoryMb: 6144
    }
  },
  repos: [
    { id: 'repo', path: repoRoot, syncPolicy: 'none' }
  ]
}, null, 2));

const runCli = (...args) => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'tools', 'service', 'indexer-service.js'), ...args],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || `indexer-service ${args[0]} failed`);
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout || '{}');
};

const indexStatus = runCli('status', '--config', configPath, '--queue', 'index', '--json');
const embeddingsStatus = runCli('status', '--config', configPath, '--queue', 'embeddings', '--json');

assert.equal(indexStatus.envelope?.queueClass, 'index');
assert.equal(indexStatus.envelope?.retry?.maxRetries, 2);
assert.equal(indexStatus.envelope?.worker?.concurrency, 1);
assert.equal(indexStatus.envelope?.worker?.maxMemoryMb, null);
assert.equal(indexStatus.envelope?.admission?.resourceBudgetUnits, 4);

assert.equal(embeddingsStatus.envelope?.queueClass, 'embeddings');
assert.equal(embeddingsStatus.envelope?.retry?.maxRetries, 5);
assert.equal(embeddingsStatus.envelope?.worker?.concurrency, 2);
assert.equal(embeddingsStatus.envelope?.worker?.maxMemoryMb, 6144);
assert.equal(embeddingsStatus.envelope?.admission?.maxQueued, 3);
assert.equal(embeddingsStatus.envelope?.admission?.resourceBudgetUnits, 12);

const embeddingsSmoke = runCli('smoke', '--config', configPath, '--queue', 'embeddings', '--json');
assert.equal(embeddingsSmoke.envelope?.queueClass, 'embeddings');
assert.equal(embeddingsSmoke.envelope?.retry?.maxRetries, 5);

console.log('indexer service embeddings envelope cli test passed');

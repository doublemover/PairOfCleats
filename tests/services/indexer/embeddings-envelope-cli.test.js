#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createIndexerServiceCliFixture } from './indexer-service-cli-fixture.js';

const { configPath, runCliJson } = await createIndexerServiceCliFixture({
  cacheName: 'indexer-service-embeddings-envelope',
  config: ({ repoRoot }) => ({
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
  })
});

const indexStatus = runCliJson('status', '--config', configPath, '--queue', 'index', '--json');
const embeddingsStatus = runCliJson('status', '--config', configPath, '--queue', 'embeddings', '--json');

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

const embeddingsSmoke = runCliJson('smoke', '--config', configPath, '--queue', 'embeddings', '--json');
assert.equal(embeddingsSmoke.envelope?.queueClass, 'embeddings');
assert.equal(embeddingsSmoke.envelope?.retry?.maxRetries, 5);

console.log('indexer service embeddings envelope cli test passed');

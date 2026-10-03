import assert from 'node:assert/strict';

import {
  isEmbeddingsQueueName,
  isMonitoredIndexQueueName,
  resolveServiceQueueName
} from '../../../tools/service/indexer-service/queue-identity.js';
import { createIndexerServiceCliFixture } from './indexer-service-cli-fixture.js';

export const createQueueIdentityCliFixture = ({ cacheName }) => createIndexerServiceCliFixture({
  cacheName,
  config: ({ repoRoot }) => ({
    queue: {
      maxRetries: 2,
      maxQueued: 20,
      maxRunning: 1,
      maxTotal: 21
    },
    worker: {
      concurrency: 1
    },
    embeddings: {
      queue: {
        maxRetries: 5,
        maxQueued: 3,
        maxRunning: 2,
        maxTotal: 5
      },
      worker: {
        concurrency: 2
      }
    },
    repos: [
      { id: 'repo', path: repoRoot, syncPolicy: 'none' }
    ]
  })
});

export const assertQueueIdentityHelpers = () => {
  assert.equal(isEmbeddingsQueueName('embeddings-stage3'), true);
  assert.equal(isEmbeddingsQueueName('index-stage2'), false);
  assert.equal(isMonitoredIndexQueueName('index-stage2'), true);
  assert.equal(isMonitoredIndexQueueName('embeddings-stage3'), false);
  assert.equal(
    resolveServiceQueueName({ queueName: 'auto', reason: 'embeddings', stage: 'stage3', mode: 'code' }),
    'embeddings-stage3-code'
  );
};

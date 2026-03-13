#!/usr/bin/env node
import path from 'node:path';
import { cleanup, runNode, root } from './smoke-utils.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

const cacheRoots = [
  resolveTestCachePath(root, 'build-embeddings-cache'),
  resolveTestCachePath(root, 'embeddings-dims-mismatch'),
  resolveTestCachePath(root, 'embeddings-cache-identity')
];

let failure = null;
try {
  await cleanup(cacheRoots);
  runNode('embeddings-cache', path.join(root, 'tests', 'indexing', 'embeddings', 'build', 'embeddings-cache.test.js'));
  runNode('onnx-session-queue', path.join(root, 'tests', 'indexing', 'embeddings', 'onnx-session-queue.test.js'));
  runNode('embeddings-cache-identity', path.join(root, 'tests', 'indexing', 'embeddings', 'cache-identity.test.js'));
  runNode('embeddings-cache-invalidation', path.join(root, 'tests', 'indexing', 'embeddings', 'cache-invalidation.test.js'));
  runNode('embeddings-dims-mismatch', path.join(root, 'tests', 'indexing', 'embeddings', 'dims-mismatch.test.js'));
} catch (err) {
  console.error(err?.message || err);
  failure = err;
}
await cleanup(cacheRoots);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke embeddings passed');


#!/usr/bin/env node
import path from 'node:path';
import { cleanup, runNode, root } from './smoke-utils.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

const cacheRoots = [
  resolveTestCachePath(root, 'build-embeddings-cache'),
  resolveTestCachePath(root, 'embeddings-stub-fastpath-dims'),
  resolveTestCachePath(root, 'embeddings-stub-fastpath-cross-repo'),
  resolveTestCachePath(root, 'embeddings-stub-fastpath-append'),
  resolveTestCachePath(root, 'embeddings-stub-fastpath-partial'),
  resolveTestCachePath(root, 'embeddings-cache-identity'),
  resolveTestCachePath(root, 'embeddings-cache-index-contract-matrix')
];

let failure = null;
try {
  await cleanup(cacheRoots);
  runNode('embeddings-cache', path.join(root, 'tests', 'indexing', 'embeddings', 'build', 'embeddings-cache.test.js'));
  runNode('onnx-session-queue', path.join(root, 'tests', 'indexing', 'embeddings', 'onnx-session-queue.test.js'));
  runNode('embeddings-cache-identity', path.join(root, 'tests', 'indexing', 'embeddings', 'cache-identity.test.js'));
  runNode('embeddings-cache-index-contract-matrix', path.join(root, 'tests', 'indexing', 'embeddings', 'cache-index-contract-matrix.test.js'));
  runNode('embeddings-stub-fastpath-cache-contract-matrix', path.join(root, 'tests', 'indexing', 'embeddings', 'stub-fastpath-cache-contract-matrix.test.js'));
} catch (err) {
  console.error(err?.message || err);
  failure = err;
}
await cleanup(cacheRoots);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke embeddings passed');


#!/usr/bin/env node
import path from 'node:path';
import { cleanup, runNode, root } from './smoke-utils.js';

const cacheRoots = [
  path.join(root, '.testCache', 'build-embeddings-cache'),
  path.join(root, '.testCache', 'embeddings-dims-mismatch'),
  path.join(root, '.testCache', 'embeddings-cache-identity')
];

let failure = null;
try {
  await cleanup(cacheRoots);
  runNode('embeddings-cache', path.join(root, 'tests', 'build-embeddings-cache.js'));
  runNode('onnx-session-queue', path.join(root, 'tests', 'onnx-session-queue.js'));
  runNode('embeddings-cache-identity', path.join(root, 'tests', 'embeddings-cache-identity.js'));
  runNode('embeddings-cache-invalidation', path.join(root, 'tests', 'embeddings-cache-invalidation.js'));
  runNode('embeddings-dims-mismatch', path.join(root, 'tests', 'embeddings-dims-mismatch.js'));
} catch (err) {
  console.error(err?.message || err);
  failure = err;
}
await cleanup(cacheRoots);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke embeddings passed');


#!/usr/bin/env node
import path from 'node:path';
import { cleanup, runNode, root } from './smoke-utils.js';

const cacheRoots = [path.join(root, '.testCache', 'type-inference-crossfile-stats')];

let failure = null;
try {
  await cleanup(cacheRoots);
  runNode('worker-pool', path.join(root, 'tests', 'indexing', 'workers', 'worker-pool.test.js'));
  runNode('crossfile-stats', path.join(root, 'tests', 'tooling', 'type-inference', 'crossfile-stats.unit.test.js'));
} catch (err) {
  console.error(err?.message || err);
  failure = err;
}
await cleanup(cacheRoots);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke workers passed');


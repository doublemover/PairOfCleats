#!/usr/bin/env node
import path from 'node:path';
import { cleanup, runNode, root } from './smoke-utils.js';

const cacheRoots = [
  path.join(root, 'tests', '.cache', 'sqlite-incremental'),
  path.join(root, 'tests', '.cache', 'sqlite-ann-fallback')
];

let failure = null;
try {
  await cleanup(cacheRoots);
  runNode('sqlite-incremental', path.join(root, 'tests', 'sqlite-incremental.js'));
  runNode('sqlite-ann-fallback', path.join(root, 'tests', 'sqlite-ann-fallback.js'));
} catch (err) {
  console.error(err?.message || err);
  failure = err;
}
await cleanup(cacheRoots);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke sqlite passed');

#!/usr/bin/env node
import path from 'node:path';
import { cleanup, runNode, root } from './smoke-utils.js';

const cacheRoots = [path.join(root, 'tests', '.cache', 'language-fidelity')];

let failure = null;
try {
  await cleanup(cacheRoots);
  runNode('worker-pool', path.join(root, 'tests', 'worker-pool.js'));
  runNode('language-fidelity', path.join(root, 'tests', 'language-fidelity.js'));
} catch (err) {
  console.error(err?.message || err);
  failure = err;
}
await cleanup(cacheRoots);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke workers passed');

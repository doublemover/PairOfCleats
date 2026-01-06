#!/usr/bin/env node
import path from 'node:path';
import { cleanup, runNode, root } from './smoke-utils.js';

const cacheRoots = [
  path.join(root, 'tests', '.cache', 'core-api'),
  path.join(root, 'tests', '.cache', 'api-server')
];

let failure = null;
try {
  await cleanup(cacheRoots);
  runNode('core-api', path.join(root, 'tests', 'core-api.js'));
  runNode('api-server', path.join(root, 'tests', 'api-server.js'));
} catch (err) {
  console.error(err?.message || err);
  failure = err;
}
await cleanup(cacheRoots);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke section1 passed');

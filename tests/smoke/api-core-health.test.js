#!/usr/bin/env node
import path from 'node:path';
import { cleanup, runNode, root } from './smoke-utils.js';

import { resolveTestCachePath } from '../helpers/test-cache.js';

const cacheRoots = [
  resolveTestCachePath(root, 'core-api'),
  resolveTestCachePath(root, 'api-health-status')
];

let failure = null;
try {
  await cleanup(cacheRoots);
  runNode('core-api', path.join(root, 'tests', 'services', 'api', 'core.test.js'));
  runNode('api-health-status', path.join(root, 'tests', 'services', 'api', 'health-and-status.test.js'));
} catch (err) {
  console.error(err?.message || err);
  failure = err;
}
await cleanup(cacheRoots);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke api-core-health passed');


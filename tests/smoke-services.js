#!/usr/bin/env node
import path from 'node:path';
import { cleanup, runNode, root } from './smoke-utils.js';

const cacheRoots = [
  path.join(root, '.testCache', 'mcp-protocol-init'),
  path.join(root, '.testCache', 'api-health-status')
];

let failure = null;
try {
  await cleanup(cacheRoots);
  runNode('mcp-protocol-init', path.join(root, 'tests', 'services', 'mcp', 'protocol-initialize.test.js'));
  runNode('api-health-status', path.join(root, 'tests', 'services', 'api', 'health-and-status.test.js'));
} catch (err) {
  console.error(err?.message || err);
  failure = err;
}
await cleanup(cacheRoots);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke services passed');


#!/usr/bin/env node
import path from 'node:path';
import { cleanup, runNode, root } from './smoke-utils.js';

const cacheRoots = [path.join(root, 'tests', '.cache', 'mcp-server')];

let failure = null;
try {
  await cleanup(cacheRoots);
  runNode('mcp-server', path.join(root, 'tests', 'mcp-server.js'));
} catch (err) {
  console.error(err?.message || err);
  failure = err;
}
await cleanup(cacheRoots);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke services passed');

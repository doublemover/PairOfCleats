#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'tools', 'service', 'indexer-service.js');
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(
  source,
  /import\s+fs\s+from\s+'node:fs';/,
  'expected indexer-service to import node:fs for config mtime checks'
);
assert.match(
  source,
  /\bfs\.statSync\(/,
  'expected indexer-service to use fs.statSync for runtime config cache invalidation'
);
assert.match(
  source,
  /exitLikeCommandResult\(\{\s*status:\s*result\.exitCode,\s*signal:\s*result\.signal\s*\}\)/,
  'expected indexer-service serve mode to preserve signal-based child exits'
);

console.log('indexer service config mtime import contract test passed');

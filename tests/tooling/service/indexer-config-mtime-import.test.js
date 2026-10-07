#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'tools', 'service', 'indexer-service.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const helperPath = path.join(root, 'tools', 'service', 'indexer-service-helpers.js');
const helperSource = fs.readFileSync(helperPath, 'utf8');

assert.match(
  source,
  /createServiceRuntimeEnvResolver/,
  'expected indexer-service to create the service runtime env resolver'
);
assert.match(
  helperSource,
  /import\s+fs\s+from\s+'node:fs';/,
  'expected indexer-service helper to import node:fs for config mtime checks'
);
assert.match(
  helperSource,
  /\bfs\.statSync\(/,
  'expected indexer-service helper to use fs.statSync for runtime config cache invalidation'
);
assert.match(
  source,
  /exitLikeCommandResult\(\{\s*status:\s*result\.exitCode,\s*signal:\s*result\.signal\s*\}\)/,
  'expected indexer-service serve mode to preserve signal-based child exits'
);

console.log('indexer service config mtime import contract test passed');

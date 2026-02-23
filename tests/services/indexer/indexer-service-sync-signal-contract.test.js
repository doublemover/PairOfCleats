#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'tools', 'service', 'indexer-service.js');
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(
  source,
  /const\s+firstSignal\s*=\s*failed\.find\([\s\S]*?\)\?\.(signal)\s*\|\|\s*null;/,
  'expected sync handler to resolve first failed git signal'
);
assert.match(
  source,
  /if\s*\(\s*firstSignal\s*\)\s*\{\s*exitLikeCommandResult\(\{\s*status:\s*null,\s*signal:\s*firstSignal\s*\}\);/s,
  'expected sync handler to propagate signal-based exits'
);

console.log('indexer service sync signal contract test passed');

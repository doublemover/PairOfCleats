#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'tools', 'service', 'indexer-service.js');
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(
  source,
  /try\s*\{\s*if\s*\(command\s*===\s*'sync'\)/,
  'expected command dispatch to run in a top-level try block'
);
assert.match(
  source,
  /\}\s*catch\s*\(\s*err\s*\)\s*\{\s*exitWithCommandError\(err\?\.\w+\s*\|\|\s*String\(err\)\);/s,
  'expected command dispatch failures to exit through JSON-aware error helper'
);

console.log('indexer service top-level error contract test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'tools', 'setup', 'bootstrap.js');
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(
  source,
  /maxBuffer:\s*64\s*\*\s*1024\s*\*\s*1024/,
  'expected bootstrap JSON-mode npm fallback to use bounded maxBuffer'
);
assert.doesNotMatch(
  source,
  /maxBuffer:\s*1024\s*\*\s*1024\s*\*\s*1024/,
  'expected bootstrap JSON-mode npm fallback to avoid 1GB maxBuffer'
);

console.log('bootstrap json buffer cap test passed');

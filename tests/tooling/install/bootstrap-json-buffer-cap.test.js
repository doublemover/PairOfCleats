#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'tools', 'setup', 'bootstrap.js');
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(
  source,
  /import\s*\{\s*spawnResolvedSubprocess\s*\}\s*from\s*'..\/..\/src\/shared\/subprocess\/command-invocation\.js'/,
  'expected bootstrap JSON-mode child execution to use shared resolved subprocess helper'
);
assert.match(
  source,
  /await\s+spawnResolvedSubprocess\(cmd,\s*args,\s*\{/,
  'expected bootstrap JSON-mode child execution to stream via shared resolved subprocess wrapper'
);
assert.doesNotMatch(
  source,
  /maxBuffer:\s*1024\s*\*\s*1024\s*\*\s*1024/,
  'expected bootstrap JSON-mode npm fallback to avoid 1GB maxBuffer'
);
assert.doesNotMatch(
  source,
  /maxBuffer:\s*64\s*\*\s*1024\s*\*\s*1024/,
  'expected bootstrap JSON-mode npm fallback to avoid buffered maxBuffer execution paths'
);

console.log('bootstrap json buffer cap test passed');

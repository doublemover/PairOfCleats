#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'tools', 'setup', 'bootstrap.js');
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(
  source,
  /const\s+isWindowsNpm\s*=\s*process\.platform\s*===\s*'win32'/,
  'expected bootstrap JSON-mode npm path to detect Windows npm shim usage'
);
assert.match(
  source,
  /const\s+commandArgs\s*=\s*isWindowsNpm\s*\?\s*\['\/d',\s*'\/s',\s*'\/c',\s*'npm',\s*\.\.\.args\]\s*:\s*args;/,
  'expected bootstrap JSON-mode npm path to run through cmd.exe shim args'
);
assert.match(
  source,
  /await\s+spawnSubprocess\(command,\s*commandArgs,/,
  'expected bootstrap JSON-mode child execution to stream via spawnSubprocess'
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

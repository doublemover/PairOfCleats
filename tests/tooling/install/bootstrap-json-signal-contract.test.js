#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'tools', 'setup', 'bootstrap.js');
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(
  source,
  /const\s+signal\s*=\s*typeof\s+result\.signal\s*===\s*'string'\s*\?\s*result\.signal\s*:\s*null;/,
  'expected bootstrap JSON child wrapper to normalize caught signal metadata'
);
assert.match(
  source,
  /status:\s*Number\.isFinite\(Number\(result\.exitCode\)\)\s*\?\s*Number\(result\.exitCode\)\s*:\s*\(signal\s*\?\s*null\s*:\s*1\)/,
  'expected bootstrap JSON child wrapper to preserve signal exits with status=null'
);

console.log('bootstrap json signal contract test passed');

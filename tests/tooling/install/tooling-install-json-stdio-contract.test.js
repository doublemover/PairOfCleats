#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'tools', 'tooling', 'install.js');
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(
  source,
  /stdio:\s*argv\.json\s*\?\s*\['inherit',\s*'ignore',\s*'inherit'\]\s*:\s*'inherit'/,
  'expected tooling-install JSON mode to suppress child stdout and keep stderr streaming'
);
assert.doesNotMatch(
  source,
  /maxBuffer\s*=\s*1024\s*\*\s*1024\s*\*\s*1024/,
  'expected tooling-install to avoid 1GB maxBuffer capture in JSON mode'
);

console.log('tooling-install json stdio contract test passed');

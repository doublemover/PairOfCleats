#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'tools', 'workspace', 'build.js');
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(
  source,
  /const\s+runRepoBuild\s*=\s*async\s*\(\s*\{\s*repo,\s*buildArgs\s*\}\s*\)\s*=>\s*\{\s*[\s\S]*?try\s*\{/,
  'expected runRepoBuild to wrap spawnSubprocess in a try block'
);
assert.match(
  source,
  /catch\s*\(\s*err\s*\)\s*\{[\s\S]*?status:\s*'failed'/,
  'expected runRepoBuild to convert spawn failures into failed diagnostics entries'
);
assert.match(
  source,
  /err\?\.message/,
  'expected runRepoBuild catch path to include thrown error messages'
);

console.log('workspace build spawn throw contract test passed');

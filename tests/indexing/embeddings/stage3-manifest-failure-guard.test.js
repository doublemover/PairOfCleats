#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = fs.readFileSync(
  path.join(root, 'tools', 'build', 'embeddings', 'runner.js'),
  'utf8'
);

assert.match(
  source,
  /if\s*\(rewriteFailures\s*===\s*0\)\s*\{[\s\S]*writeIncrementalManifest\(/,
  'expected stage3 manifest embedding coverage updates to be gated on zero rewrite failures'
);
assert.match(
  source,
  /warn\(\s*`?\[embeddings\].*skipped manifest embedding coverage update after/,
  'expected stage3 refresh to emit an explicit warning when manifest coverage updates are skipped after rewrite failures'
);

console.log('stage3 manifest failure guard test passed');

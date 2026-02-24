#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'src', 'shared', 'artifact-io', 'json.js');
const source = await fs.readFile(sourcePath, 'utf8');

assert.match(
  source,
  /const destroyStream = \(\) => \{[\s\S]*?stream\.destroy\(\);[\s\S]*?stream = null;[\s\S]*?\};/m,
  'expected JSONL iterator to define centralized stream destruction helper'
);
assert.doesNotMatch(
  source,
  /lastErr = err;\s*stream = null;/m,
  'expected candidate error path to avoid nulling stream without destruction'
);
assert.match(
  source,
  /lastErr = err;\s*destroyStream\(\);/m,
  'expected candidate error path to destroy active stream before fallback'
);

console.log('json iterator stream cleanup contract test passed');

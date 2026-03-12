#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { discoverFiles } from '../../../src/index/build/discover.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'ignore-file-overrides');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'dist'), { recursive: true });
await fs.writeFile(path.join(tempRoot, '.gitignore'), 'dist/**\n!dist/allow.js\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'dist', 'allow.js'), 'console.log("ok")\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'dist', 'deny.js'), 'console.log("no")\n', 'utf8');

const { ignoreMatcher } = await buildIgnoreMatcher({
  root: tempRoot,
  userConfig: {}
});

const entries = await discoverFiles({
  root: tempRoot,
  mode: 'code',
  ignoreMatcher,
  skippedFiles: [],
  maxFileBytes: null
});

const rels = entries.map((entry) => entry.rel).sort();
assert.equal(rels.includes('dist/allow.js'), true, 'expected allow.js to survive .gitignore negation');
assert.equal(rels.includes('dist/deny.js'), false, 'expected deny.js to remain ignored');

console.log('ignore file override test passed');

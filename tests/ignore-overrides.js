#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIgnoreMatcher } from '../src/index/build/ignore.js';
import { discoverFiles } from '../src/index/build/discover.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'ignore-overrides');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'dist'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'dist', 'allow.js'), 'console.log("ok")');
await fs.writeFile(path.join(tempRoot, 'dist', 'deny.js'), 'console.log("no")');

const { ignoreMatcher } = await buildIgnoreMatcher({
  root: tempRoot,
  userConfig: {
    extraIgnore: ['!dist/allow.js']
  }
});

const entries = await discoverFiles({
  root: tempRoot,
  mode: 'code',
  ignoreMatcher,
  skippedFiles: [],
  maxFileBytes: null
});

const rels = entries.map((entry) => entry.rel).sort();
if (!rels.includes('dist/allow.js')) {
  console.error('ignore override test failed: allow.js not discovered');
  process.exit(1);
}
if (rels.includes('dist/deny.js')) {
  console.error('ignore override test failed: deny.js should be ignored');
  process.exit(1);
}

console.log('ignore override test passed');


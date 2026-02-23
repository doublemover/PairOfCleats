#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { discoverFiles } from '../../../src/index/build/discover.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'discover-max-files-abort-crawl');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
for (let i = 0; i < 64; i += 1) {
  const name = String(i).padStart(3, '0');
  await fs.writeFile(path.join(tempRoot, 'src', `file-${name}.js`), `export const v${i} = ${i};\n`, 'utf8');
}

const { ignoreMatcher } = await buildIgnoreMatcher({ root: tempRoot, userConfig: {} });
const skipped = [];

const originalLstat = fsPromises.lstat;
let lstatCount = 0;
fsPromises.lstat = async (...args) => {
  if (String(args[0]).startsWith(tempRoot)) lstatCount += 1;
  return originalLstat(...args);
};

let entries = [];
try {
  entries = await discoverFiles({
    root: tempRoot,
    mode: 'code',
    scmProvider: null,
    scmProviderImpl: null,
    scmRepoRoot: null,
    ignoreMatcher,
    skippedFiles: skipped,
    maxFileBytes: null,
    maxFiles: 1
  });
} finally {
  fsPromises.lstat = originalLstat;
}

assert.ok(entries.length <= 1, 'maxFiles should cap discovered entries');
assert.ok(
  skipped.some((entry) => entry.reason === 'max_files_reached'),
  'expected deterministic max_files_reached reason'
);
assert.ok(
  lstatCount <= 2,
  `expected early abort to stop lstat traversal quickly (observed=${lstatCount})`
);

console.log('discover maxFiles abort crawl test passed');

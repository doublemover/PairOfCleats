#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { discoverFiles } from '../../../src/index/build/discover.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'discover-max-files-no-drop-during-inflight-reject');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'src', 'good-a.js'), 'export const a = 1;\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'src', 'good-b.js'), 'export const b = 2;\n', 'utf8');

const { ignoreMatcher } = await buildIgnoreMatcher({ root: tempRoot, userConfig: {} });
const skipped = [];
const missingPath = path.join(tempRoot, 'src', 'missing.js');
const scmProviderImpl = {
  async listTrackedFiles() {
    return {
      ok: true,
      filesPosix: ['src/good-a.js', 'src/missing.js', 'src/good-b.js']
    };
  }
};

const originalLstat = fsPromises.lstat;
fsPromises.lstat = async (...args) => {
  const target = String(args[0] || '');
  if (target === missingPath) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    throw err;
  }
  return originalLstat(...args);
};

let entries = [];
try {
  entries = await discoverFiles({
    root: tempRoot,
    mode: 'code',
    scmProvider: 'git',
    scmProviderImpl,
    scmRepoRoot: tempRoot,
    ignoreMatcher,
    skippedFiles: skipped,
    maxFileBytes: null,
    maxFiles: 2
  });
} finally {
  fsPromises.lstat = originalLstat;
}

const rels = entries.map((entry) => entry.rel).sort();
assert.equal(entries.length, 2, 'expected discovery to fill maxFiles despite in-flight rejected reservation');
assert.deepEqual(rels, ['src/good-a.js', 'src/good-b.js']);
assert.ok(skipped.some((entry) => entry.reason === 'stat-failed'), 'expected delayed missing candidate to be rejected');

console.log('discover maxFiles no drop during inflight reject test passed');

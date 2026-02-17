#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { discoverFiles } from '../../../src/index/build/discover.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'discover-max-files-continues-after-reject');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'src', 'good.js'), 'export const good = true;\n', 'utf8');

const { ignoreMatcher } = await buildIgnoreMatcher({ root: tempRoot, userConfig: {} });
const skipped = [];
const scmProviderImpl = {
  async listTrackedFiles() {
    return {
      ok: true,
      filesPosix: ['src/missing.js', 'src/good.js']
    };
  }
};

const entries = await discoverFiles({
  root: tempRoot,
  mode: 'code',
  scmProvider: 'git',
  scmProviderImpl,
  scmRepoRoot: tempRoot,
  ignoreMatcher,
  skippedFiles: skipped,
  maxFileBytes: null,
  maxFiles: 1
});

assert.equal(entries.length, 1, 'maxFiles should still accept one entry after rejected reservation');
assert.equal(entries[0].rel, 'src/good.js', 'expected discovery to continue to next candidate');
assert.ok(skipped.some((entry) => entry.reason === 'stat-failed'), 'expected first candidate to be rejected');
assert.ok(
  skipped.some((entry) => entry.reason === 'max_files_reached'),
  'expected deterministic max_files_reached reason after cap is met'
);

console.log('discover maxFiles continues after rejected candidate test passed');

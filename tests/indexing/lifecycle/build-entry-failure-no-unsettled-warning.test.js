#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import path from 'node:path';

import { repoRoot } from '../../helpers/root.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = repoRoot();
const buildIndexPath = path.join(root, 'build_index.js');
const env = applyTestEnv({
  embeddings: 'stub',
  syncProcess: false
});

const result = spawnSync(
  process.execPath,
  [buildIndexPath, '--not-a-real-flag'],
  {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 15000
  }
);

assert.equal(result.status, 1, `expected build entry failure exit 1, stdout=${result.stdout || ''}`);
assert.match(result.stderr || '', /Index build failed:/, 'expected failure banner on stderr');
assert.match(result.stderr || '', /unknown options: not-a-real-flag/, 'expected unknown-option detail on stderr');
assert.doesNotMatch(
  `${result.stderr || ''}${result.stdout || ''}`,
  /Detected unsettled top-level await/,
  'expected failing build entry to avoid unsettled top-level await warning'
);

console.log('build entry failure no-unsettled-warning test passed');

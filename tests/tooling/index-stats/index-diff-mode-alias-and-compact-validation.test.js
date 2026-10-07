#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'index-diff-mode-alias-and-compact-validation');
const repoRoot = path.join(tempRoot, 'repo');
const env = applyTestEnv({ syncProcess: false });

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });

const listWithMode = runNode(
  [
    path.join(root, 'tools', 'index-diff.js'),
    'list',
    '--repo',
    repoRoot,
    '--mode',
    'code',
    '--json'
  ],
  'index diff list mode alias',
  root,
  env,
  { stdio: 'pipe' }
);

assert.equal(listWithMode.status, 0, 'expected tools/index-diff.js list --mode to succeed');
const payload = JSON.parse(String(listWithMode.stdout || '{}'));
assert.equal(payload?.ok, true, 'expected json payload ok=true');
assert.ok(Array.isArray(payload?.diffs), 'expected diffs array in json payload');

const compactRejected = runNode(
  [
    path.join(root, 'bin', 'pairofcleats.js'),
    'index',
    'diff',
    'list',
    '--repo',
    repoRoot,
    '--compact'
  ],
  'index diff compact rejection',
  root,
  env,
  { stdio: 'pipe', allowFailure: true }
);

assert.notEqual(compactRejected.status, 0, 'expected --compact to be rejected');
assert.match(
  String(compactRejected.stderr || ''),
  /Unknown flag: --compact/,
  'expected compact rejection message'
);

console.log('index diff mode alias and compact validation test passed');

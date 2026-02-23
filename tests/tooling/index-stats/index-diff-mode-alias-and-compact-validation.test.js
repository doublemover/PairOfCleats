#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'index-diff-mode-alias-and-compact-validation');
const repoRoot = path.join(tempRoot, 'repo');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });

const listWithMode = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'index-diff.js'),
    'list',
    '--repo',
    repoRoot,
    '--mode',
    'code',
    '--json'
  ],
  { cwd: root, encoding: 'utf8' }
);

assert.equal(listWithMode.status, 0, 'expected tools/index-diff.js list --mode to succeed');
const payload = JSON.parse(String(listWithMode.stdout || '{}'));
assert.equal(payload?.ok, true, 'expected json payload ok=true');
assert.ok(Array.isArray(payload?.diffs), 'expected diffs array in json payload');

const compactRejected = spawnSync(
  process.execPath,
  [
    path.join(root, 'bin', 'pairofcleats.js'),
    'index',
    'diff',
    'list',
    '--repo',
    repoRoot,
    '--compact'
  ],
  { cwd: root, encoding: 'utf8' }
);

assert.notEqual(compactRejected.status, 0, 'expected --compact to be rejected');
assert.match(
  String(compactRejected.stderr || ''),
  /Unknown flag: --compact/,
  'expected compact rejection message'
);

console.log('index diff mode alias and compact validation test passed');

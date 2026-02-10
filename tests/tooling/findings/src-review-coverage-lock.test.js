#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { repoRoot } from '../../helpers/root.js';

applyTestEnv();

const root = repoRoot();
const scriptPath = path.join(root, 'tools', 'docs', 'src-review-coverage.js');
const markdownPath = path.join(root, 'docs', 'tooling', 'src-review-unreviewed-batches-2026-02-10.md');
const jsonPath = path.join(root, 'docs', 'tooling', 'src-review-coverage.json');

const result = spawnSync(process.execPath, [scriptPath, '--check'], {
  cwd: root,
  encoding: 'utf8'
});

if (result.status !== 0) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
}

assert.equal(result.status, 0, 'src review coverage lock check should pass');
assert.ok(fs.existsSync(markdownPath), 'coverage markdown artifact is missing');
assert.ok(fs.existsSync(jsonPath), 'coverage json artifact is missing');

console.log('src review coverage lock test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listTrackedHeaderPaths } from '../../../../src/index/tooling/clangd-provider.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'clangd-tracked-headers-cache-invalidation');
const repoRoot = path.join(tempRoot, 'repo');

const gitVersion = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitVersion.status !== 0) {
  console.log('clangd tracked headers cache invalidation test skipped (git unavailable).');
  process.exit(0);
}

const runGit = (args) => {
  const result = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout || 'unknown error'}`);
    process.exit(1);
  }
  return String(result.stdout || '');
};

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'include'), { recursive: true });

runGit(['init']);
runGit(['config', 'user.email', 'test@example.com']);
runGit(['config', 'user.name', 'Test User']);

await fs.writeFile(path.join(repoRoot, 'include', 'a.h'), '#pragma once\n');
runGit(['add', 'include/a.h']);

const first = listTrackedHeaderPaths(repoRoot).map((entry) => entry.replace(/\\/g, '/'));
assert.ok(first.includes('include/a.h'), 'expected first scan to include a.h');
assert.ok(!first.includes('include/b.h'), 'did not expect first scan to include b.h');

await fs.writeFile(path.join(repoRoot, 'include', 'b.h'), '#pragma once\n');
await new Promise((resolve) => setTimeout(resolve, 25));
runGit(['add', 'include/b.h']);

const second = listTrackedHeaderPaths(repoRoot).map((entry) => entry.replace(/\\/g, '/'));
assert.ok(second.includes('include/a.h'), 'expected cache refresh to retain a.h');
assert.ok(second.includes('include/b.h'), 'expected cache refresh to include newly added b.h');

console.log('clangd tracked headers cache invalidation test passed');

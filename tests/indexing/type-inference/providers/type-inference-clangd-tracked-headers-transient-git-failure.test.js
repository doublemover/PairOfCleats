#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listTrackedHeaderPaths } from '../../../../src/index/tooling/clangd-provider.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'clangd-tracked-headers-transient-git-failure');
const repoRoot = path.join(tempRoot, 'repo');

const gitVersion = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitVersion.status !== 0) {
  console.log('clangd tracked headers transient git failure test skipped (git unavailable).');
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

const originalPATH = process.env.PATH;
const originalPath = process.env.Path;

try {
  process.env.PATH = '';
  process.env.Path = '';
  const failed = listTrackedHeaderPaths(repoRoot);
  assert.deepEqual(failed, [], 'expected transient git failure to return empty header list');
} finally {
  if (originalPATH === undefined) delete process.env.PATH;
  else process.env.PATH = originalPATH;
  if (originalPath === undefined) delete process.env.Path;
  else process.env.Path = originalPath;
}

const recovered = listTrackedHeaderPaths(repoRoot).map((entry) => entry.replace(/\\/g, '/'));
assert.ok(recovered.includes('include/a.h'), 'expected tracked header listing to recover after transient git failure');

console.log('clangd tracked headers transient git failure test passed');

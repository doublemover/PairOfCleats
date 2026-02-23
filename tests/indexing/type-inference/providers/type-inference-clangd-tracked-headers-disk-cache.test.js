#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { listTrackedHeaderPaths } from '../../../../src/index/tooling/clangd-provider.js';
import { skip } from '../../../helpers/skip.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'clangd-tracked-headers-disk-cache');
const repoRoot = path.join(tempRoot, 'repo');
const cacheDir = path.join(tempRoot, 'cache');

const gitVersion = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitVersion.status !== 0) {
  skip('clangd tracked headers disk cache test skipped (git unavailable).');
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

const first = listTrackedHeaderPaths(repoRoot, { cacheDir }).map((entry) => entry.replace(/\\/g, '/'));
assert.ok(first.includes('include/a.h'), 'expected tracked header listing to include include/a.h');

const cachePath = path.join(cacheDir, 'clangd', 'clangd-tracked-headers-v1.json');
const cacheRaw = await fs.readFile(cachePath, 'utf8');
const cache = JSON.parse(cacheRaw);
const repoEntry = cache?.repos?.[path.resolve(repoRoot)];
assert.ok(repoEntry, 'expected disk cache entry for repository');
assert.equal(repoEntry.paths?.includes('include/a.h'), true, 'expected disk cache to persist tracked headers');

console.log('clangd tracked headers disk cache test passed');

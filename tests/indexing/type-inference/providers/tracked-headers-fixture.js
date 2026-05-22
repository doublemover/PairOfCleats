import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { listTrackedHeaderPaths } from '../../../../src/index/tooling/clangd-provider.js';
import { skip } from '../../../helpers/skip.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';

export const normalizeTrackedHeaders = (repoRoot, options = {}) => (
  listTrackedHeaderPaths(repoRoot, options).map((entry) => entry.replace(/\\/g, '/'))
);

export const prepareTrackedHeaderRepo = async (cacheName) => {
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, cacheName);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheDir = path.join(tempRoot, 'cache');

  const gitVersion = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (gitVersion.status !== 0) {
    skip(`clangd tracked headers ${cacheName} test skipped (git unavailable).`);
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

  return { cacheDir, repoRoot, runGit, tempRoot };
};

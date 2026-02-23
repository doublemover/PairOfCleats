#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { discoverFiles } from '../../../src/index/build/discover.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
import { skip } from '../../helpers/skip.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'discover-scm-root-alias');
const repoRoot = path.join(tempRoot, 'repo');
const aliasRoot = path.join(tempRoot, 'repo-alias');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });

const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitCheck.status !== 0) {
  skip('git not available');
}

const runGit = (args) => {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
};

await fs.writeFile(path.join(repoRoot, 'src', 'tracked.js'), 'console.log("tracked")\n', 'utf8');
runGit(['init']);
runGit(['config', 'user.email', 'tests@example.com']);
runGit(['config', 'user.name', 'Tests']);
runGit(['add', '.']);
runGit(['commit', '-m', 'init']);
await fs.writeFile(path.join(repoRoot, 'src', 'untracked.js'), 'console.log("untracked")\n', 'utf8');

try {
  await fs.symlink(repoRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
} catch {
  skip('symlink/junction not available');
}

const { ignoreMatcher } = await buildIgnoreMatcher({ root: aliasRoot, userConfig: {} });
const entries = await discoverFiles({
  root: aliasRoot,
  mode: 'code',
  scmProvider: 'git',
  scmProviderImpl: gitProvider,
  scmRepoRoot: repoRoot,
  ignoreMatcher,
  skippedFiles: [],
  maxFileBytes: null
});

const relPaths = new Set(entries.map((entry) => entry.rel));
assert.ok(relPaths.has('src/tracked.js'), 'tracked file should be discovered');
assert.ok(!relPaths.has('src/untracked.js'), 'untracked file should be excluded when SCM discovery is active');

console.log('discover scm root alias test passed');

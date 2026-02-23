#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { discoverFiles } from '../../../src/index/build/discover.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
import { repoRoot } from '../../helpers/root.js';
import { skip } from '../../helpers/skip.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = repoRoot();
const tempRoot = resolveTestCachePath(root, 'discover-leading-space');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitCheck.status !== 0) {
  skip('git not available');
}

const runGit = (args) => {
  const result = spawnSync('git', args, { cwd: tempRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
};

runGit(['init']);
runGit(['config', 'user.email', 'tests@example.com']);
runGit(['config', 'user.name', 'Tests']);

await fs.writeFile(path.join(tempRoot, 'src', ' spaced.js'), 'console.log("hi")\n');
runGit(['add', '.']);
runGit(['commit', '-m', 'init']);

const { ignoreMatcher } = await buildIgnoreMatcher({ root: tempRoot, userConfig: {} });
const entries = await discoverFiles({
  root: tempRoot,
  mode: 'code',
  scmProvider: 'git',
  scmProviderImpl: gitProvider,
  scmRepoRoot: tempRoot,
  ignoreMatcher,
  skippedFiles: [],
  maxFileBytes: null
});

const rels = entries.map((entry) => entry.rel);
assert.ok(rels.includes('src/ spaced.js'), 'expected leading-space filename to be preserved');

console.log('discover git leading-space test passed');

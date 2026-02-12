#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoRoot, resolveRepoConfig, resolveRepoRootArg, toRealPathSync } from '../../../tools/shared/dict-utils.js';

const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitCheck.status !== 0) {
  console.log('[skip] git not available');
  process.exit(0);
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-explicit-repo-root-'));
const nestedRoot = path.join(tempRoot, 'fixtures', 'mini-repo');
await fs.mkdir(nestedRoot, { recursive: true });

const runGit = (args, cwd) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout || ''}`);
  }
};

runGit(['init'], tempRoot);
runGit(['config', 'user.email', 'test@example.com'], tempRoot);
runGit(['config', 'user.name', 'Test User'], tempRoot);
await fs.writeFile(path.join(tempRoot, 'README.md'), '# test\n', 'utf8');
runGit(['add', '.'], tempRoot);
runGit(['commit', '-m', 'init'], tempRoot);

const expectedExplicit = toRealPathSync(nestedRoot);
assert.equal(resolveRepoRootArg(nestedRoot), expectedExplicit, 'explicit repo arg should not collapse to git toplevel');
assert.equal(getRepoRoot(nestedRoot), expectedExplicit, 'getRepoRoot(explicit) should preserve explicit root');
assert.equal(resolveRepoConfig(nestedRoot).repoRoot, expectedExplicit, 'resolveRepoConfig(explicit) should preserve explicit root');

const expectedImplicit = toRealPathSync(tempRoot);
assert.equal(resolveRepoRootArg(null, nestedRoot), expectedImplicit, 'implicit repo root should still follow git toplevel');

console.log('explicit repo root arg test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRepoId, getRepoRoot, resolveRepoConfig, resolveRepoRootArg, toRealPathSync } from '../../../tools/shared/dict-utils.js';
import { ensureGitAvailableOrSkip, initGitRepo, runGit } from '../../helpers/git-fixture.js';

if (!ensureGitAvailableOrSkip()) {
  process.exit(0);
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-explicit-repo-root-'));
const nestedRoot = path.join(tempRoot, 'fixtures', 'mini-repo');
await fs.mkdir(nestedRoot, { recursive: true });

initGitRepo(tempRoot);
await fs.writeFile(path.join(tempRoot, 'README.md'), '# test\n', 'utf8');
runGit(['add', '.'], { cwd: tempRoot, label: 'git add' });
runGit(['commit', '-m', 'init'], { cwd: tempRoot, label: 'git commit' });

const expectedExplicit = toRealPathSync(nestedRoot);
assert.equal(resolveRepoRootArg(nestedRoot), expectedExplicit, 'explicit repo arg should not collapse to git toplevel');
assert.equal(getRepoRoot(nestedRoot), expectedExplicit, 'getRepoRoot(explicit) should preserve explicit root');
assert.equal(resolveRepoConfig(nestedRoot).repoRoot, expectedExplicit, 'resolveRepoConfig(explicit) should preserve explicit root');

const expectedImplicit = toRealPathSync(tempRoot);
assert.equal(resolveRepoRootArg(null, nestedRoot), expectedImplicit, 'implicit repo root should still follow git toplevel');

if (process.platform === 'win32') {
  const variantUpper = nestedRoot.replace(/[a-z]/g, (ch) => ch.toUpperCase());
  const variantLower = nestedRoot.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
  assert.equal(
    getRepoId(variantUpper),
    getRepoId(variantLower),
    'repo id should be stable across Windows path casing variants'
  );
}

console.log('explicit repo root arg test passed');

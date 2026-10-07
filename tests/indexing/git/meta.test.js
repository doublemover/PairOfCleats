#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getGitMeta } from '../../../src/index/git.js';
import { ensureGitAvailableOrSkip, initGitRepo, runGit } from '../../helpers/git-fixture.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

if (!ensureGitAvailableOrSkip()) process.exit(0);
const root = await makeTempDir('poc-git-meta-');
try {
  initGitRepo(root);
  const target = path.join(root, 'README.md');
  await fs.writeFile(target, '# Local metadata fixture\n', 'utf8');
  runGit(['add', 'README.md'], { cwd: root });
  runGit(['-c', 'commit.gpgsign=false', 'commit', '-m', 'metadata fixture'], { cwd: root });

  const blameEnabled = await getGitMeta(target, 1, 1, { blame: true, baseDir: root });
  const blameDisabled = await getGitMeta(target, 1, 1, { blame: false, baseDir: root });

  assert.equal(blameDisabled.chunk_authors, undefined, 'disabled blame must omit chunk authors');
  assert.deepEqual(blameEnabled.chunk_authors, ['Test User'], 'enabled blame must resolve fixture line authors');
  assert.equal(blameEnabled.last_commit, blameDisabled.last_commit, 'blame toggle must retain file metadata');
} finally {
  await rmDirRecursive(root);
}

console.log('Git metadata config test passed');

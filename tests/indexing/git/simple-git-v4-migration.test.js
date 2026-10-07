#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { getGitMetaForFile, getRepoBranch, getRepoProvenance } from '../../../src/index/git.js';
import { resolveRepoBranch } from '../../../src/retrieval/cli/branch-filter.js';
import { readRepoGitState } from '../../../tools/shared/git-state.js';
import { indexStatus } from '../../../tools/mcp/repo.js';
import { initGitRepo, runGit } from '../../helpers/git-fixture.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const root = await makeTempDir('poc-git-v4-migration-');
const originalGitDir = process.env.GIT_DIR;
const originalVisual = process.env.VISUAL;
try {
  // A real repository is required; an unavailable Git executable must fail this test.
  initGitRepo(root);
  runGit(['checkout', '-b', 'migration-fixture'], { cwd: root });
  const file = path.join(root, 'file with spaces.js');
  await fs.writeFile(file, 'export const first = 1;\n');
  runGit(['add', '--', path.basename(file)], { cwd: root });
  runGit(['-c', 'commit.gpgsign=false', 'commit', '-m', 'first fixture'], { cwd: root });
  await fs.appendFile(file, 'export const second = 2;\n');
  runGit(['add', '--', path.basename(file)], { cwd: root });
  runGit(['-c', 'commit.gpgsign=false', 'commit', '-m', 'second fixture'], { cwd: root });
  const head = runGit(['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
  runGit(['remote', 'add', 'origin', 'https://example.invalid/fixture.git'], { cwd: root });

  // The v4 guard must discard ambient redirection without an unsafe opt-in.
  process.env.GIT_DIR = path.join(root, 'nonexistent-git-dir');
  process.env.VISUAL = 'poc-editor-must-not-run';
  assert.deepEqual(await getRepoBranch(root), { branch: 'migration-fixture', isRepo: true });
  assert.deepEqual(await getRepoProvenance(root), {
    commit: head, dirty: false, branch: 'migration-fixture', isRepo: true
  });
  assert.deepEqual(await readRepoGitState(root, { includeRemote: true }), {
    head, dirty: false, remote: 'https://example.invalid/fixture.git'
  });
  assert.equal(await resolveRepoBranch({ root, metricsDir: path.join(root, 'missing-metrics') }), 'migration-fixture');
  const status = await indexStatus({ repoPath: root });
  assert.deepEqual(status.git, { isRepo: true, head, branch: 'migration-fixture', isDirty: false });
  const meta = await getGitMetaForFile(file, { baseDir: root, blame: true });
  assert.equal(meta.last_commit, head);
  assert.equal(meta.last_author, 'Test User');
  assert.equal(meta.churn_added, 2);
  assert.equal(meta.churn_deleted, 0);
  assert.equal(meta.churn_commits, 2);
  assert.deepEqual(meta.lineAuthors, ['Test User', 'Test User']);
  await fs.appendFile(file, '// dirty fixture\n');
  assert.equal((await getRepoProvenance(root)).dirty, true);

  // Explicit unsafe editor environments must still be rejected before spawning.
  await assert.rejects(
    simpleGit({ baseDir: root }).env({ PATH: process.env.PATH, VISUAL: 'poc-editor-must-not-run' }).raw(['var', 'GIT_EDITOR']),
    /VISUAL|environment guard|editor/i
  );
  // A missing repository must remain a structured fallback rather than an import error.
  assert.deepEqual(await getRepoBranch(path.join(root, 'does-not-exist')), { branch: null, isRepo: false });
  console.log('simple-git v4 real repository migration passed');
} finally {
  if (originalGitDir === undefined) delete process.env.GIT_DIR;
  else process.env.GIT_DIR = originalGitDir;
  if (originalVisual === undefined) delete process.env.VISUAL;
  else process.env.VISUAL = originalVisual;
  await rmDirRecursive(root);
}

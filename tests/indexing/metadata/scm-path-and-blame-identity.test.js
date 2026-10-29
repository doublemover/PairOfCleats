import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getGitLineAuthorsForFile } from '../../../src/index/git.js';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
import { normalizeScmFileKey, toUniqueRepoPosixFiles } from '../../../src/index/scm/paths.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

assert.deepEqual(toUniqueRepoPosixFiles(['a.js', ' a.js', 'folder/../ a.js', 'trailing ']), ['a.js', ' a.js', 'trailing ']);
assert.equal(normalizeScmFileKey('../outside'), null);
const { dir } = await prepareTestCacheDir('scm-path-blame-identity');
const git = (args, name = 'Alice') => execFileSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 10000, windowsHide: true,
  env: { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: `${name.toLowerCase()}@fixture.invalid`,
    GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: `${name.toLowerCase()}@fixture.invalid`, GIT_TERMINAL_PROMPT: '0' } }).trim();
try {
  git(['init', '--quiet']);
  await fs.writeFile(path.join(dir, 'a.js'), 'const value = 1;\n');
  await fs.writeFile(path.join(dir, ' a.js'), 'const spaced = 1;\n');
  // Git trees admit a trailing-space path even where Windows checkout does not.
  // Exercise the real metadata/churn parser against that exact stored identity.
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir,
    input: 'const trailing = 1;\n', encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
  git(['-c', 'core.protectNTFS=false', 'update-index', '--add', '--cacheinfo', '100644', blob, 'trailing.js ']);
  git(['add', '--', 'a.js', ' a.js']); git(['commit', '--quiet', '-m', 'first']);
  const first = git(['rev-parse', 'HEAD']);
  assert.deepEqual(await getGitLineAuthorsForFile('a.js', { baseDir: dir }), ['Alice']);
  await fs.writeFile(path.join(dir, 'a.js'), 'const value = 2;\n');
  git(['add', '--', 'a.js'], 'Bob'); git(['commit', '--quiet', '-m', 'second'], 'Bob');
  const second = git(['rev-parse', 'HEAD']);
  assert.deepEqual(await getGitLineAuthorsForFile('a.js', { baseDir: dir, commitId: first }), ['Alice']);
  assert.deepEqual(await getGitLineAuthorsForFile('a.js', { baseDir: dir, commitId: second }), ['Bob']);
  assert.deepEqual(await getGitLineAuthorsForFile('a.js', { baseDir: dir }), ['Bob']);
  const plain = await gitProvider.getFileMetaBatch({ repoRoot: dir, filesPosix: ['a.js', ' a.js', 'trailing.js '], headId: second, includeChurn: false });
  assert.ok(plain.fileMetaByPath['a.js']);
  assert.ok(plain.fileMetaByPath[' a.js'], 'batch parsing preserves leading filename whitespace');
  const withChurn = await gitProvider.getFileMetaBatch({ repoRoot: dir, filesPosix: ['a.js', ' a.js', 'trailing.js '], headId: second, includeChurn: true });
  assert.ok(Number.isFinite(withChurn.fileMetaByPath[' a.js']?.churn));
  assert.ok(plain.fileMetaByPath['trailing.js ']);
  assert.ok(Number.isFinite(withChurn.fileMetaByPath['trailing.js ']?.churn));
  assert.ok(withChurn.fileMetaByPath['a.js'].churn > 0, 'churn request cannot reuse non-churn evidence');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('SCM path and blame identity test passed');

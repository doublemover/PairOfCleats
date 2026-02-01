#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getGitMeta } from '../../../src/index/git.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'churn-filter');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitCheck.status !== 0) {
  console.log('[skip] git not available');
  process.exit(0);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const runGit = (args, label) => {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
};

runGit(['init'], 'git init');
runGit(['config', 'user.email', 'test@example.com'], 'git config email');
runGit(['config', 'user.name', 'Test User'], 'git config name');

const sourcePath = path.join(repoRoot, 'notes.md');
await fsPromises.writeFile(
  sourcePath,
  [
    'alpha',
    'beta'
  ].join('\n')
);

runGit(['add', '.'], 'git add initial');
runGit(['commit', '-m', 'initial'], 'git commit initial');

await fsPromises.writeFile(
  sourcePath,
  [
    'alpha',
    'gamma',
    'delta'
  ].join('\n')
);

runGit(['add', '.'], 'git add update');
runGit(['commit', '-m', 'update'], 'git commit update');

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
const repoArgs = ['--repo', repoRoot];

const gitMeta = await getGitMeta('notes.md', 1, 2, { blame: false, baseDir: repoRoot });
const expectedChurn = 5;
if (gitMeta.churn !== expectedChurn) {
  console.error(`Expected churn ${expectedChurn}, got ${gitMeta.churn}`);
  process.exit(1);
}

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', ...repoArgs],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('Failed: build_index');
  process.exit(buildResult.status ?? 1);
}

const searchPath = path.join(root, 'search.js');

function runSearch(args, label) {
  const result = spawnSync(
    process.execPath,
    [searchPath, 'alpha', '--mode', 'prose', '--json', '--no-ann', ...args, ...repoArgs],
    { cwd: repoRoot, env, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    console.error(result.stderr || result.stdout || '');
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout || '{}');
}

const defaultPayload = runSearch(['--churn'], 'search churn default');
if (!Array.isArray(defaultPayload.prose) || defaultPayload.prose.length === 0) {
  console.error('Expected results for --churn default.');
  process.exit(1);
}

const zeroPayload = runSearch(['--churn', '0'], 'search churn 0');
if (!Array.isArray(zeroPayload.prose) || zeroPayload.prose.length === 0) {
  console.error('Expected results for --churn 0.');
  process.exit(1);
}

const highPayload = runSearch(['--churn', '999999'], 'search churn 999999');
if (Array.isArray(highPayload.prose) && highPayload.prose.length > 0) {
  console.error('Expected no results for --churn 999999.');
  process.exit(1);
}

const badResult = spawnSync(
  process.execPath,
  [searchPath, 'alpha', '--mode', 'prose', '--json', '--churn', 'not-a-number', ...repoArgs],
  { cwd: repoRoot, env, encoding: 'utf8' }
);
if (badResult.status === 0) {
  console.error('Expected --churn not-a-number to fail.');
  process.exit(1);
}

console.log('Churn filter test passed');


#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

applyTestEnv({ testing: '1' });

const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (gitCheck.status !== 0) {
  console.log('[skip] git not available');
  process.exit(0);
}

const tempRoot = await makeTempDir('poc-git-meta-batch-churn-');
const repoRoot = path.join(tempRoot, 'repo');

const runGit = (args, label) => {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result;
};

try {
  await fsPromises.mkdir(repoRoot, { recursive: true });
  runGit(['init'], 'git init');
  runGit(['config', 'user.email', 'alpha@example.com'], 'git config email alpha');
  runGit(['config', 'user.name', 'Alpha Author'], 'git config name alpha');

  const samplePath = path.join(repoRoot, 'sample.js');
  await fsPromises.writeFile(samplePath, [
    'const alpha = 1;',
    'const beta = 2;',
    'const gamma = 3;'
  ].join('\n') + '\n');
  runGit(['add', 'sample.js'], 'git add sample alpha');
  runGit(['commit', '-m', 'alpha'], 'git commit alpha');

  runGit(['config', 'user.email', 'beta@example.com'], 'git config email beta');
  runGit(['config', 'user.name', 'Beta Author'], 'git config name beta');
  await fsPromises.writeFile(samplePath, [
    'const alpha = 10;',
    'const gamma = 3;',
    'const delta = 4;'
  ].join('\n') + '\n');
  runGit(['add', 'sample.js'], 'git add sample beta');
  runGit(['commit', '-m', 'beta'], 'git commit beta');

  const batch = await gitProvider.getFileMetaBatch({
    repoRoot,
    filesPosix: ['sample.js'],
    timeoutMs: 15000,
    includeChurn: true
  });

  assert.equal(batch?.ok === false, false, 'expected git batch metadata fetch to succeed');
  const meta = batch?.fileMetaByPath?.['sample.js'];
  assert.ok(meta, 'expected batch metadata for sample.js');
  assert.equal(meta.lastAuthor, 'Beta Author');
  assert.equal(typeof meta.lastCommitId, 'string');
  assert.equal(meta.lastCommitId.length >= 7, true, 'expected normalized commit id');
  assert.equal(meta.lastModifiedAt !== null, true, 'expected last-modified timestamp');
  assert.equal(Number.isFinite(meta.churnAdded), true, 'expected batch churnAdded');
  assert.equal(Number.isFinite(meta.churnDeleted), true, 'expected batch churnDeleted');
  assert.equal(Number.isFinite(meta.churnCommits), true, 'expected batch churnCommits');
  assert.equal(meta.churnCommits >= 2, true, 'expected two commits in churn window');
  assert.equal(meta.churn === meta.churnAdded + meta.churnDeleted, true, 'expected churn total to match adds+deletes');
} finally {
  await rmDirRecursive(tempRoot);
}

console.log('git meta batch churn test passed');

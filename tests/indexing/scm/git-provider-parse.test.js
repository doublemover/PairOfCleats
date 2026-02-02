#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
import { getScmCommandRunner, setScmCommandRunner } from '../../../src/index/scm/runner.js';

const defaultRunner = getScmCommandRunner();
const calls = [];

try {
  setScmCommandRunner(async (command, args) => {
    calls.push({ command, args });
    if (args.includes('ls-files')) {
      return { exitCode: 0, stdout: 'src\\a.js\0src/b.js\0', stderr: '' };
    }
    if (args.includes('diff')) {
      return { exitCode: 0, stdout: 'src/c.js\nsrc/d.js\n', stderr: '' };
    }
    return { exitCode: 1, stdout: '', stderr: '' };
  });

  const repoRoot = path.resolve('C:/repo');
  const listResult = await gitProvider.listTrackedFiles({ repoRoot, subdir: 'src' });
  assert.deepEqual(listResult.filesPosix, ['src/a.js', 'src/b.js']);

  const diffResult = await gitProvider.getChangedFiles({
    repoRoot,
    fromRef: 'HEAD~1',
    toRef: 'HEAD',
    subdir: 'src'
  });
  assert.deepEqual(diffResult.filesPosix, ['src/c.js', 'src/d.js']);
  assert(calls.some((entry) => entry.command === 'git'));
} finally {
  setScmCommandRunner(defaultRunner);
}

console.log('git provider parse ok');

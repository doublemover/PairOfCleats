#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getGitMetaForFile } from '../../../src/index/git.js';
import { setScmCommandRunner } from '../../../src/index/scm/runner.js';

const root = process.cwd();
const target = path.join(root, 'README.md');

if (!fs.existsSync(target)) {
  console.error(`Missing README.md at ${target}`);
  process.exit(1);
}

let calls = 0;
setScmCommandRunner(async () => {
  calls += 1;
  return {
    exitCode: 128,
    stdout: '',
    stderr: 'fatal: not a git repository (or any of the parent directories): .git'
  };
});

try {
  const first = await getGitMetaForFile(target, { blame: false, baseDir: root, timeoutMs: 5 });
  assert.deepEqual(first, {}, 'expected fast non-zero git log to return empty metadata');
  const firstCallCount = calls;
  assert.equal(firstCallCount, 1, 'expected one SCM invocation on first non-zero fast-path call');

  const second = await getGitMetaForFile(target, { blame: false, baseDir: root, timeoutMs: 5 });
  assert.deepEqual(second, {}, 'expected disabled git state to keep returning empty metadata');
  assert.equal(calls, firstCallCount, 'expected non-zero fast-path git metadata failure to trigger backoff');
} finally {
  setScmCommandRunner(null);
}

console.log('git meta fast non-zero backoff test passed');

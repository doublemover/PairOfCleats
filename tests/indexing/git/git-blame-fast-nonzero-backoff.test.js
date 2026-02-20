#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getGitLineAuthorsForFile } from '../../../src/index/git.js';
import { setScmCommandRunner } from '../../../src/index/scm/runner.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

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
  const first = await getGitLineAuthorsForFile(target, { baseDir: root, timeoutMs: 5 });
  assert.equal(first, null, 'expected failed fast blame call to return null');
  const firstCallCount = calls;
  assert.equal(firstCallCount, 1, 'expected one SCM invocation for first blame call');

  const second = await getGitLineAuthorsForFile(target, { baseDir: root, timeoutMs: 5 });
  assert.equal(second, null, 'expected temporary disable to keep blame result null');
  assert.equal(calls, firstCallCount, 'expected failed fast blame to trigger backoff before retry');
} finally {
  setScmCommandRunner(null);
}

console.log('git blame fast non-zero backoff test passed');

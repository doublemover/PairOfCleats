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
    exitCode: 0,
    stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1\nauthor Test Author\n\tline\n',
    stderr: ''
  };
});

const commitA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const commitB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

try {
  const first = await getGitLineAuthorsForFile(target, { baseDir: root, timeoutMs: 5, commitId: commitA });
  assert.deepEqual(first, ['Test Author'], 'expected blame parse on first call');
  assert.equal(calls, 1, 'expected first call to hit scm runner');

  const second = await getGitLineAuthorsForFile(target, { baseDir: root, timeoutMs: 5, commitId: commitA });
  assert.deepEqual(second, ['Test Author'], 'expected cached blame for same commit+path');
  assert.equal(calls, 1, 'expected same commit+path to use cache');

  const third = await getGitLineAuthorsForFile(target, { baseDir: root, timeoutMs: 5, commitId: commitB });
  assert.deepEqual(third, ['Test Author'], 'expected blame parse after commit change');
  assert.equal(calls, 2, 'expected commit change to invalidate blame cache key');
} finally {
  setScmCommandRunner(null);
}

console.log('git blame commit cache scope test passed');

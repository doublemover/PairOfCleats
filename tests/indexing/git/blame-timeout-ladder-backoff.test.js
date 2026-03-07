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

const timeoutAttempts = [];
let calls = 0;
setScmCommandRunner(async (_command, _args, options = {}) => {
  calls += 1;
  timeoutAttempts.push(options?.timeoutMs ?? null);
  const err = new Error('forced blame timeout');
  err.code = 'SUBPROCESS_TIMEOUT';
  throw err;
});

try {
  const first = await getGitLineAuthorsForFile(target, { baseDir: root, timeoutMs: 8 });
  assert.equal(first, null, 'expected timeout ladder to return null when all attempts fail');
  assert.deepEqual(timeoutAttempts, [4, 8], 'expected blame timeout ladder attempts to escalate toward configured timeout');

  const firstCallCount = calls;
  const second = await getGitLineAuthorsForFile(target, { baseDir: root, timeoutMs: 8 });
  assert.equal(second, null, 'expected temporary disable after timeout ladder exhaustion');
  assert.equal(calls, firstCallCount, 'expected backoff to suppress repeated blame invocations');
} finally {
  setScmCommandRunner(null);
}

console.log('git blame timeout ladder backoff test passed');

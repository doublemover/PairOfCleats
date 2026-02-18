#!/usr/bin/env node
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
  const err = new Error('forced scm timeout');
  err.code = 'SUBPROCESS_TIMEOUT';
  throw err;
});

try {
  await getGitMetaForFile(target, { blame: false, baseDir: root, timeoutMs: 5 });
  const firstCallCount = calls;
  if (firstCallCount <= 0) {
    console.error('Expected first git metadata call to invoke SCM runner.');
    process.exit(1);
  }

  await getGitMetaForFile(target, { blame: false, baseDir: root, timeoutMs: 5 });
  if (calls !== firstCallCount) {
    console.error('Expected git metadata timeout backoff to skip repeated SCM invocations.');
    process.exit(1);
  }
} finally {
  setScmCommandRunner(null);
}

console.log('git meta timeout backoff test passed');

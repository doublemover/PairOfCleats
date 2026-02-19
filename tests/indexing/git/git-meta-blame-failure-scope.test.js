#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getGitLineAuthorsForFile, getGitMetaForFile } from '../../../src/index/git.js';
import { setScmCommandRunner } from '../../../src/index/scm/runner.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const target = path.join(root, 'README.md');

if (!fs.existsSync(target)) {
  console.error(`Missing README.md at ${target}`);
  process.exit(1);
}

let blameCalls = 0;
let logCalls = 0;
let numstatCalls = 0;

setScmCommandRunner(async (_command, args) => {
  const argv = Array.isArray(args) ? args : [];
  if (argv.includes('blame')) {
    blameCalls += 1;
    return {
      exitCode: 128,
      stdout: '',
      stderr: 'fatal: forced blame failure'
    };
  }
  if (argv.includes('--format=%aI%x00%an')) {
    logCalls += 1;
    return {
      exitCode: 0,
      stdout: '2024-01-01T00:00:00+00:00\0Test Author',
      stderr: ''
    };
  }
  if (argv.includes('--numstat')) {
    numstatCalls += 1;
    return {
      exitCode: 0,
      stdout: '1\t2\tREADME.md\n',
      stderr: ''
    };
  }
  return { exitCode: 0, stdout: '', stderr: '' };
});

try {
  const blame = await getGitLineAuthorsForFile(target, { baseDir: root, timeoutMs: 5 });
  assert.equal(blame, null, 'expected failed blame call to return null');
  assert.equal(blameCalls, 1, 'expected one blame invocation');

  const meta = await getGitMetaForFile(target, { blame: false, baseDir: root, timeoutMs: 5 });
  assert.equal(meta.last_author, 'Test Author', 'expected metadata lookup to continue after blame failure');
  assert.equal(meta.last_modified, '2024-01-01T00:00:00+00:00', 'expected metadata timestamp to be populated');
  assert.equal(logCalls, 1, 'expected metadata log command to run');
  assert.equal(numstatCalls, 1, 'expected metadata churn command to run');
} finally {
  setScmCommandRunner(null);
}

console.log('git metadata remains available after blame failure test passed');

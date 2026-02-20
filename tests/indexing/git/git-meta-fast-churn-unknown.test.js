#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getGitMetaForFile } from '../../../src/index/git.js';
import { setScmCommandRunner } from '../../../src/index/scm/runner.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const target = path.join(root, 'README.md');

if (!fs.existsSync(target)) {
  console.error(`Missing README.md at ${target}`);
  process.exit(1);
}

let logCalls = 0;
let churnCalls = 0;

setScmCommandRunner(async (_command, args) => {
  if (Array.isArray(args) && args.includes('--numstat')) {
    churnCalls += 1;
    return { exitCode: 124, stdout: '', stderr: 'timed out' };
  }
  logCalls += 1;
  return {
    exitCode: 0,
    stdout: '2026-02-18T00:00:00+00:00\0Test Author\n',
    stderr: ''
  };
});

try {
  const meta = await getGitMetaForFile(target, {
    blame: false,
    baseDir: root,
    timeoutMs: 5,
    includeChurn: true
  });
  assert.equal(logCalls, 1, 'expected one fast git log head call');
  assert.equal(churnCalls, 1, 'expected one fast git log --numstat call');
  assert.equal(meta.last_modified, '2026-02-18T00:00:00+00:00');
  assert.equal(meta.last_author, 'Test Author');
  assert.equal(meta.churn, null, 'expected churn to remain unknown on numstat failure');
  assert.equal(meta.churn_added, null, 'expected churn_added to remain unknown on numstat failure');
  assert.equal(meta.churn_deleted, null, 'expected churn_deleted to remain unknown on numstat failure');
  assert.equal(meta.churn_commits, null);
} finally {
  setScmCommandRunner(null);
}

console.log('git meta fast churn unknown test passed');

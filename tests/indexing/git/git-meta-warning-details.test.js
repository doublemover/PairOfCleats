#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getGitMetaForFile } from '../../../src/index/git.js';
import { setScmCommandRunner } from '../../../src/index/scm/runner.js';
import { setProgressHandlers } from '../../../src/shared/progress.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const tempRoot = path.join(process.cwd(), '.testCache', 'git-meta-warning-details');
fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });

const target = path.join(tempRoot, 'sample.js');
fs.writeFileSync(target, 'console.log(1);\n', 'utf8');

const lines = [];
const restoreHandlers = setProgressHandlers({
  log: (message) => {
    lines.push(String(message || ''));
  }
});

setScmCommandRunner(async () => {
  const err = new Error('forced scm timeout');
  err.code = 'SUBPROCESS_TIMEOUT';
  throw err;
});

try {
  await getGitMetaForFile(target, {
    blame: false,
    baseDir: tempRoot,
    timeoutMs: 5
  });
} finally {
  setScmCommandRunner(null);
  restoreHandlers();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const warning = lines.find((line) => line.includes('[git] Git metadata unavailable'));
assert.ok(warning, 'expected git metadata warning to be emitted');
assert.match(warning, /scope=meta/i, 'expected warning to include meta scope');
assert.match(warning, /file=sample\.js/i, 'expected warning to include file path');
assert.match(warning, /timeoutMs=5/i, 'expected warning to include timeout');
assert.match(warning, /code=SUBPROCESS_TIMEOUT/i, 'expected warning to include error code');
assert.match(warning, /reason=forced scm timeout/i, 'expected warning to include error reason');

console.log('git metadata warning details test passed');

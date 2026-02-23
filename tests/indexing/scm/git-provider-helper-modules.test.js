#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  appendDiffRefArgs,
  appendScopedSubdirArg,
  parseLines,
  parseNullSeparated,
  parseProviderFileList
} from '../../../src/index/scm/providers/git/path-normalization.js';
import {
  createGitMetaBatchFailure,
  resolveTimeoutPlan
} from '../../../src/index/scm/providers/git/timeout-policy.js';

const repoRoot = path.resolve('C:/repo');

const tracked = parseProviderFileList({
  stdout: 'src\\b.js\0src/a.js\0',
  repoRoot,
  parser: parseNullSeparated
});
assert.deepEqual(tracked, ['src/a.js', 'src/b.js']);

const changed = parseProviderFileList({
  stdout: 'src\\d.js\nsrc/c.js\n',
  repoRoot,
  parser: parseLines
});
assert.deepEqual(changed, ['src/c.js', 'src/d.js']);

const diffArgs = appendDiffRefArgs(['-C', repoRoot, 'diff', '--name-only'], {
  fromRef: 'HEAD~1',
  toRef: 'HEAD'
});
assert.deepEqual(diffArgs.slice(-2), ['HEAD~1', 'HEAD']);

const scopedArgs = appendScopedSubdirArg([...diffArgs], { repoRoot, subdir: 'src' });
assert.deepEqual(scopedArgs.slice(-2), ['--', 'src']);

const timeoutFailure = createGitMetaBatchFailure({
  err: Object.assign(new Error('timed out while collecting metadata'), {
    code: 'SUBPROCESS_TIMEOUT'
  })
});
assert.equal(timeoutFailure.timeoutLike, true);
assert.equal(timeoutFailure.fatalUnavailable, false);

const fatalFailure = createGitMetaBatchFailure({
  result: {
    exitCode: 128,
    stdout: '',
    stderr: 'fatal: not a git repository (or any of the parent directories): .git'
  }
});
assert.equal(fatalFailure.timeoutLike, false);
assert.equal(fatalFailure.fatalUnavailable, true);

const timeoutPlan = resolveTimeoutPlan({
  baseTimeoutMs: 1000,
  timeoutPolicy: {
    retryMaxAttempts: 4,
    minTimeoutMs: 500,
    maxTimeoutMs: 5000
  },
  chunkCost: {
    multiplier: 1.4,
    sizeTier: 2,
    maxTimeouts: 1
  }
});
assert.equal(timeoutPlan.length, 4);
assert.deepEqual(timeoutPlan, [...timeoutPlan].sort((left, right) => left - right));
assert(timeoutPlan.every((value) => value >= 500 && value <= 5000));

console.log('git provider helper modules ok');

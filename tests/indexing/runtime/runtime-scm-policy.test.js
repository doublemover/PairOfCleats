#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  logRuntimeScmPolicy,
  resolveRuntimeScmAnnotatePolicy
} from '../../../src/index/build/runtime/runtime-scm-init.js';

applyTestEnv();

{
  const logs = [];
  const policy = resolveRuntimeScmAnnotatePolicy({
    scmConfig: {
      timeoutMs: 88.9,
      annotate: {
        enabled: true,
        timeoutMs: 12.4,
        timeoutLadderMs: [5, '9.9', 0, -1, 'oops', 18.1]
      }
    },
    scmProvider: 'none',
    log: (line) => logs.push(line)
  });

  assert.equal(policy.scmAnnotateEnabled, true, 'expected annotate policy enabled in config');
  assert.equal(policy.gitBlameEnabled, false, 'expected provider=none to disable annotate runtime');
  assert.equal(policy.scmTimeoutMs, 88, 'expected scm timeout to normalize to floor(ms)');
  assert.equal(policy.scmAnnotateTimeoutMs, 12, 'expected annotate timeout to normalize to floor(ms)');
  assert.deepEqual(
    policy.scmAnnotateTimeoutLadder,
    [5, 9, 18],
    'expected annotate timeout ladder to keep only positive finite entries'
  );
  assert.equal(logs[0], '[scm] annotate disabled: provider=none.');
}

{
  const logs = [];
  const policy = resolveRuntimeScmAnnotatePolicy({
    scmConfig: {
      annotate: {
        enabled: false,
        timeoutLadderMs: ['bad']
      }
    },
    scmProvider: 'git',
    log: (line) => logs.push(line)
  });

  assert.equal(policy.scmAnnotateEnabled, false, 'expected explicit annotate=false respected');
  assert.equal(policy.gitBlameEnabled, false, 'expected annotate=false to disable blame policy');
  assert.equal(policy.scmTimeoutMs, null, 'expected invalid scm timeout to normalize to null');
  assert.equal(policy.scmAnnotateTimeoutMs, null, 'expected missing annotate timeout to normalize to null');
  assert.deepEqual(policy.scmAnnotateTimeoutLadder, [], 'expected invalid timeout ladder entries filtered out');
  assert.equal(logs.length, 0, 'expected no provider=none warning when annotate is disabled');
}

{
  const logs = [];
  logRuntimeScmPolicy({
    log: (line) => logs.push(line),
    scmProvider: 'git',
    gitBlameEnabled: true,
    benchRun: false,
    scmTimeoutMs: null,
    scmAnnotateTimeoutMs: 25,
    scmAnnotateTimeoutLadder: [10, 25, 50]
  });

  assert.equal(logs.length, 1, 'expected single scm policy summary line');
  assert.match(logs[0], /provider=git/, 'expected provider in scm policy log');
  assert.match(logs[0], /annotate=on/, 'expected annotate status in scm policy log');
  assert.match(logs[0], /benchRun=0/, 'expected benchRun flag in scm policy log');
  assert.match(logs[0], /metaTimeoutMs=default/, 'expected scm timeout default token in log');
  assert.match(logs[0], /annotateTimeoutMs=25/, 'expected annotate timeout in scm policy log');
  assert.match(logs[0], /annotateLadder=10>25>50/, 'expected timeout ladder in scm policy log');
}

console.log('runtime scm policy test passed');

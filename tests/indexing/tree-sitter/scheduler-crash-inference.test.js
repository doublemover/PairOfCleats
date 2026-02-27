#!/usr/bin/env node
import assert from 'node:assert/strict';
import { treeSitterSchedulerRunnerInternals } from '../../../src/index/build/tree-sitter-scheduler/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const {
  isSubprocessCrashExit,
  inferFailedGrammarKeysFromSubprocessOutput
} = treeSitterSchedulerRunnerInternals;

assert.equal(isSubprocessCrashExit({ exitCode: 0, signal: null }), false, 'zero exit should not classify as crash');
assert.equal(isSubprocessCrashExit({ exitCode: 1, signal: null }), false, 'generic nonzero exit should not classify as crash');
assert.equal(isSubprocessCrashExit({ exitCode: 3221225477, signal: null }), true, 'NTSTATUS access violation should classify as crash');
assert.equal(isSubprocessCrashExit({ exitCode: -1073741819, signal: null }), true, 'negative native crash exit should classify as crash');
assert.equal(isSubprocessCrashExit({ exitCode: null, signal: 'SIGSEGV' }), true, 'signal exits should classify as crash');

const grammarKeys = ['native:yaml~b02of06', 'native:yaml~b04of06', 'native:yaml~b06of06'];

const failedTailOnly = inferFailedGrammarKeysFromSubprocessOutput({
  grammarKeysForTask: grammarKeys,
  stdout: [
    '[tree-sitter:schedule] native:yaml~b02of06: start mem=rss=100MB',
    '[tree-sitter:schedule] native:yaml~b02of06: done mem=rss=120MB',
    '[tree-sitter:schedule] native:yaml~b04of06: start mem=rss=121MB',
    '[tree-sitter:schedule] native:yaml~b04of06: done mem=rss=122MB',
    '[tree-sitter:schedule] native:yaml~b06of06: start mem=rss=123MB'
  ].join('\n')
});
assert.deepEqual(
  failedTailOnly,
  ['native:yaml~b06of06'],
  'expected only final grammar key to be marked failed when prior keys completed'
);

const failedFromFirst = inferFailedGrammarKeysFromSubprocessOutput({
  grammarKeysForTask: grammarKeys,
  stdout: '[tree-sitter:schedule] native:yaml~b02of06: start mem=rss=100MB'
});
assert.deepEqual(
  failedFromFirst,
  grammarKeys,
  'expected all keys in task to fail when first key started but never completed'
);

const failedWithoutLifecycle = inferFailedGrammarKeysFromSubprocessOutput({
  grammarKeysForTask: grammarKeys,
  stdout: '',
  stderr: '[fatal] parser worker terminated unexpectedly'
});
assert.deepEqual(
  failedWithoutLifecycle,
  grammarKeys,
  'expected fallback to all task keys when no lifecycle output is available'
);

console.log('tree-sitter scheduler crash inference test passed');

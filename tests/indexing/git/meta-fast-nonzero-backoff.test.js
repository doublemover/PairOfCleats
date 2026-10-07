#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getGitMetaForFile } from '../../../src/index/git.js';
import {
  createCountingFatalGitRunner,
  ensureGitMetaReadmeTarget,
  withScmCommandRunner
} from './git-meta-fixture.js';

const { root, target } = ensureGitMetaReadmeTarget();
const gitFailure = createCountingFatalGitRunner();

await withScmCommandRunner(gitFailure.runner, async () => {
  const first = await getGitMetaForFile(target, { blame: false, baseDir: root, timeoutMs: 5 });
  assert.deepEqual(first, {}, 'expected fast non-zero git log to return empty metadata');
  const firstCallCount = gitFailure.getCallCount();
  assert.equal(firstCallCount, 1, 'expected one SCM invocation on first non-zero fast-path call');

  const second = await getGitMetaForFile(target, { blame: false, baseDir: root, timeoutMs: 5 });
  assert.deepEqual(second, {}, 'expected disabled git state to keep returning empty metadata');
  assert.equal(gitFailure.getCallCount(), firstCallCount, 'expected non-zero fast-path git metadata failure to trigger backoff');
});

console.log('git meta fast non-zero backoff test passed');

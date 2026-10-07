#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getGitLineAuthorsForFile } from '../../../src/index/git.js';
import {
  createCountingFatalGitRunner,
  ensureGitMetaReadmeTarget,
  withScmCommandRunner
} from './git-meta-fixture.js';

const { root, target } = ensureGitMetaReadmeTarget();
const gitFailure = createCountingFatalGitRunner();

await withScmCommandRunner(gitFailure.runner, async () => {
  const first = await getGitLineAuthorsForFile(target, { baseDir: root, timeoutMs: 5 });
  assert.equal(first, null, 'expected failed fast blame call to return null');
  const firstCallCount = gitFailure.getCallCount();
  assert.equal(firstCallCount, 1, 'expected one SCM invocation for first blame call');

  const second = await getGitLineAuthorsForFile(target, { baseDir: root, timeoutMs: 5 });
  assert.equal(second, null, 'expected temporary disable to keep blame result null');
  assert.equal(gitFailure.getCallCount(), firstCallCount, 'expected failed fast blame to trigger backoff before retry');
});

console.log('git blame fast non-zero backoff test passed');

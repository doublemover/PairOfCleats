#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getTrackedSubprocessCount, spawnSubprocess } from '../../../src/shared/subprocess.js';
import { resolveSilentStdio } from '../../helpers/test-env.js';

const waitFor = async (predicate, timeoutMs = 5000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
};

const assertCallbackFailure = async ({
  script,
  stdio,
  handlerKey,
  expectedStream
}) => {
  let caught = null;
  try {
    await spawnSubprocess(process.execPath, ['-e', script], {
      stdio,
      killTree: true,
      [handlerKey]: () => {
        throw new Error(`${handlerKey}-boom`);
      }
    });
    assert.fail(`expected ${handlerKey} callback failure`);
  } catch (error) {
    caught = error;
  }

  assert.equal(caught?.code, 'SUBPROCESS_FAILED', `expected controlled failure code for ${handlerKey}`);
  assert.match(
    String(caught?.message || ''),
    new RegExp(`${expectedStream} callback failed`, 'i'),
    `expected ${expectedStream} callback failure message`
  );
  assert.match(
    String(caught?.cause?.message || ''),
    /-boom$/,
    `expected ${handlerKey} callback throw to be preserved as cause`
  );

  const trackedCleared = await waitFor(() => getTrackedSubprocessCount() === 0, 5000);
  assert.equal(trackedCleared, true, `expected tracked subprocess cleanup after ${handlerKey} failure`);
};

await assertCallbackFailure({
  script: 'process.stdout.write("chunk\\n"); setInterval(() => {}, 1000);',
  stdio: ['ignore', resolveSilentStdio('pipe'), 'ignore'],
  handlerKey: 'onStdout',
  expectedStream: 'stdout'
});

await assertCallbackFailure({
  script: 'process.stderr.write("chunk\\n"); setInterval(() => {}, 1000);',
  stdio: ['ignore', 'ignore', resolveSilentStdio('pipe')],
  handlerKey: 'onStderr',
  expectedStream: 'stderr'
});

console.log('subprocess output callback guard test passed');

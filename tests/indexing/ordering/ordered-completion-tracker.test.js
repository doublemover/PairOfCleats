#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { waitForChildExit } from '../../helpers/process-lifecycle.js';
import { createOrderedCompletionTracker } from '../../../src/index/build/indexer/steps/process-files.js';
import { runWithTimeout } from '../../../src/shared/promise-timeout.js';

ensureTestingEnv(process.env);

const tracker = createOrderedCompletionTracker();
tracker.track(Promise.resolve('ok'));
await tracker.wait();

const failedTracker = createOrderedCompletionTracker();
const marker = new Error('ordered append failed');
failedTracker.track(Promise.reject(marker));
await new Promise((resolve) => setTimeout(resolve, 0));

let caught = null;
try {
  await failedTracker.wait();
} catch (err) {
  caught = err;
}

assert.equal(caught, marker, 'expected tracker.wait to rethrow completion failures');

const throwTracker = createOrderedCompletionTracker();
const throwMarker = new Error('ordered completion failed after capacity gate');
throwTracker.track(Promise.reject(throwMarker));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.throws(
  () => throwTracker.throwIfFailed(),
  (err) => err === throwMarker,
  'expected throwIfFailed to surface settled completion failures'
);

const drainingTracker = createOrderedCompletionTracker();
const earlyMarker = new Error('first completion failed quickly');
let settledCount = 0;
drainingTracker.track(Promise.reject(earlyMarker), () => {
  settledCount += 1;
});
drainingTracker.track(
  new Promise((resolve) => setTimeout(() => resolve('slow-success'), 25)),
  () => {
    settledCount += 1;
  }
);
const drainStart = Date.now();
let drainError = null;
try {
  await drainingTracker.wait();
} catch (err) {
  drainError = err;
}
const drainElapsedMs = Date.now() - drainStart;
assert.equal(drainError, earlyMarker, 'expected wait to report first completion failure');
assert.equal(settledCount, 2, 'expected wait to drain all tracked completions before returning');
assert.ok(drainElapsedMs >= 15, 'expected wait to hold until slow completion settled');

const stalledTracker = createOrderedCompletionTracker();
let resolveStalled = null;
stalledTracker.track(new Promise((resolve) => {
  resolveStalled = resolve;
}));
let stallCallbacks = 0;
await stalledTracker.wait({
  stallPollMs: 10,
  onStall: ({ pending, stallCount }) => {
    stallCallbacks += 1;
    assert.equal(pending, 1, 'expected stall callback to report pending completions');
    if (stallCount >= 2) {
      resolveStalled?.();
    }
  }
});
assert.ok(stallCallbacks >= 2, 'expected wait to invoke stall callback while blocked');

const timeoutTracker = createOrderedCompletionTracker();
timeoutTracker.track(new Promise(() => {}));
await assert.rejects(
  () => timeoutTracker.wait({ timeoutMs: 25 }),
  (err) => err?.code === 'ORDERED_COMPLETION_TIMEOUT',
  'expected wait timeout to produce deterministic timeout error'
);

const nestedTimeoutTracker = createOrderedCompletionTracker();
nestedTimeoutTracker.track(new Promise(() => {}));
await assert.rejects(
  () => runWithTimeout(
    (signal) => nestedTimeoutTracker.wait({ signal }),
    {
      timeoutMs: 25,
      errorFactory: () => {
        const error = new Error('outer ordered completion timeout');
        error.code = 'ORDERED_COMPLETION_OUTER_TIMEOUT';
        return error;
      }
    }
  ),
  (err) => err?.code === 'ORDERED_COMPLETION_OUTER_TIMEOUT',
  'expected outer timeout to abort inner ordered completion wait'
);

const abortTracker = createOrderedCompletionTracker();
abortTracker.track(new Promise(() => {}));
const abortController = new AbortController();
setTimeout(() => abortController.abort(new Error('abort tracker wait')), 10);
await assert.rejects(
  () => abortTracker.wait({ signal: abortController.signal }),
  (err) => (err?.message || '').includes('abort tracker wait'),
  'expected wait abort signal to reject with abort reason'
);

const keepaliveScript = [
  "import { createOrderedCompletionTracker } from './src/shared/concurrency/ordered-completion.js';",
  'const tracker = createOrderedCompletionTracker();',
  'tracker.track(new Promise(() => {}));',
  'await tracker.wait();'
].join('\n');
const keepaliveChild = spawn(
  process.execPath,
  ['--input-type=module', '-e', keepaliveScript],
  {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  }
);
let keepaliveStderr = '';
keepaliveChild.stderr.on('data', (chunk) => {
  keepaliveStderr += String(chunk);
});
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(
  keepaliveChild.exitCode,
  null,
  `expected ordered completion wait child to remain alive while completion is pending; stderr=${keepaliveStderr || '<empty>'}`
);
keepaliveChild.kill();
const keepaliveExitCode = await waitForChildExit(keepaliveChild, {
  timeoutMs: 5000,
  forceSignal: 'SIGKILL'
});
assert.notEqual(
  keepaliveExitCode,
  13,
  `expected ordered completion keepalive to avoid unsettled top-level await exit 13; stderr=${keepaliveStderr || '<empty>'}`
);

const preWaitKeepaliveScript = [
  "import { createOrderedCompletionTracker } from './src/shared/concurrency/ordered-completion.js';",
  'const tracker = createOrderedCompletionTracker();',
  'tracker.track(new Promise(() => {}));',
  "await new Promise((resolve) => setTimeout(resolve, 500));"
].join('\n');
const preWaitKeepaliveChild = spawn(
  process.execPath,
  ['--input-type=module', '-e', preWaitKeepaliveScript],
  {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  }
);
let preWaitKeepaliveStderr = '';
preWaitKeepaliveChild.stderr.on('data', (chunk) => {
  preWaitKeepaliveStderr += String(chunk);
});
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(
  preWaitKeepaliveChild.exitCode,
  null,
  `expected tracked completion to keep process alive before wait() is called; stderr=${preWaitKeepaliveStderr || '<empty>'}`
);
preWaitKeepaliveChild.kill();
const preWaitKeepaliveExitCode = await waitForChildExit(preWaitKeepaliveChild, {
  timeoutMs: 5000,
  forceSignal: 'SIGKILL'
});
assert.notEqual(
  preWaitKeepaliveExitCode,
  13,
  `expected tracked completion keepalive to avoid unsettled top-level await exit 13 before wait(); stderr=${preWaitKeepaliveStderr || '<empty>'}`
);

const nestedTimeoutKeepaliveScript = [
  "import { createOrderedCompletionTracker } from './src/shared/concurrency/ordered-completion.js';",
  "import { runWithTimeout } from './src/shared/promise-timeout.js';",
  'const tracker = createOrderedCompletionTracker();',
  'tracker.track(new Promise(() => {}));',
  'try {',
  '  await runWithTimeout((signal) => tracker.wait({ signal }), {',
  '    timeoutMs: 25,',
  '    errorFactory: () => { const error = new Error(\"outer timeout\"); error.code = \"ORDERED_COMPLETION_OUTER_TIMEOUT\"; return error; }',
  '  });',
  '} catch {}'
].join('\n');
const nestedTimeoutKeepaliveChild = spawn(
  process.execPath,
  ['--input-type=module', '-e', nestedTimeoutKeepaliveScript],
  {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  }
);
let nestedTimeoutKeepaliveStderr = '';
nestedTimeoutKeepaliveChild.stderr.on('data', (chunk) => {
  nestedTimeoutKeepaliveStderr += String(chunk);
});
const nestedTimeoutKeepaliveExitCode = await waitForChildExit(nestedTimeoutKeepaliveChild, {
  timeoutMs: 5000,
  forceSignal: 'SIGKILL'
});
assert.notEqual(
  nestedTimeoutKeepaliveExitCode,
  13,
  `expected outer timeout to terminate cleanly instead of leaving ordered completion wait alive; stderr=${nestedTimeoutKeepaliveStderr || '<empty>'}`
);

console.log('ordered completion tracker test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createTimeoutError, runWithTimeout } from '../../../src/shared/promise-timeout.js';

ensureTestingEnv(process.env);

const ok = await runWithTimeout(() => Promise.resolve('ok'), { timeoutMs: 50 });
assert.equal(ok, 'ok', 'expected runWithTimeout to resolve successful operations');

const timeoutErr = await runWithTimeout(
  () => new Promise((resolve) => setTimeout(() => resolve('late'), 60)),
  { timeoutMs: 10 }
).then(() => null, (err) => err);
assert.ok(timeoutErr instanceof Error, 'expected timeout rejection');
assert.equal(timeoutErr.code, 'ERR_TIMEOUT');

const customErr = await runWithTimeout(
  () => new Promise((resolve) => setTimeout(() => resolve('late'), 60)),
  {
    timeoutMs: 10,
    errorFactory: () => createTimeoutError({
      message: 'custom timeout',
      code: 'CUSTOM_TIMEOUT',
      retryable: false
    })
  }
).then(() => null, (err) => err);
assert.ok(customErr instanceof Error, 'expected custom timeout rejection');
assert.equal(customErr.code, 'CUSTOM_TIMEOUT');
assert.equal(customErr.retryable, false);

let observedAbortReason = null;
const abortingTimeoutErr = await runWithTimeout(
  (signal) => new Promise((resolve) => {
    signal?.addEventListener('abort', () => {
      observedAbortReason = signal.reason || null;
      resolve('aborted');
    }, { once: true });
  }),
  {
    timeoutMs: 10,
    errorFactory: () => createTimeoutError({
      message: 'abort timeout',
      code: 'ABORT_TIMEOUT'
    })
  }
).then(() => null, (err) => err);
assert.ok(abortingTimeoutErr instanceof Error, 'expected timeout rejection when operation aborts');
assert.equal(abortingTimeoutErr.code, 'ABORT_TIMEOUT');
assert.ok(observedAbortReason instanceof Error, 'expected abort reason to be propagated to operation signal');
assert.equal(observedAbortReason.code, 'ABORT_TIMEOUT');

console.log('promise timeout contract test passed');

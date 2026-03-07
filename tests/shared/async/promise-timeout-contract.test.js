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

const preAbortedController = new AbortController();
preAbortedController.abort(new Error('already-aborted'));
const preAbortedErr = await runWithTimeout(
  () => Promise.resolve('unexpected-success'),
  { timeoutMs: 50, signal: preAbortedController.signal }
).then(() => null, (err) => err);
assert.ok(preAbortedErr instanceof Error, 'expected immediate abort rejection for pre-aborted signal');
assert.equal(preAbortedErr.code, 'ABORT_ERR');
assert.match(String(preAbortedErr.message || ''), /already-aborted/i);

const upstreamAbortController = new AbortController();
const upstreamAbortErrPromise = runWithTimeout(
  () => new Promise((resolve) => {
    setTimeout(() => resolve('ignored-abort-success'), 80);
  }),
  { timeoutMs: 500, signal: upstreamAbortController.signal }
).then(() => null, (err) => err);
setTimeout(() => upstreamAbortController.abort(new Error('upstream-stop')), 20);
const upstreamAbortErr = await upstreamAbortErrPromise;
assert.ok(upstreamAbortErr instanceof Error, 'expected upstream abort to reject runWithTimeout');
assert.equal(upstreamAbortErr.code, 'ABORT_ERR');
assert.match(String(upstreamAbortErr.message || ''), /upstream-stop/i);

console.log('promise timeout contract test passed');

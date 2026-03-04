#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createLifecycleRegistry } from '../../../src/shared/lifecycle/registry.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const asyncCloseError = new Error('async disposer close failed');
const reportedErrors = [];
const unhandledRejections = [];
const onUnhandledRejection = (reason) => {
  unhandledRejections.push(reason);
};

process.on('unhandledRejection', onUnhandledRejection);
try {
  const registry = createLifecycleRegistry({
    name: 'lifecycle-disposer-async-close',
    onError: (err) => reportedErrors.push(err)
  });
  const unregister = registry.register(null, {
    label: 'async-close',
    close: async () => {
      throw asyncCloseError;
    }
  });
  unregister();
  await sleep(20);
  assert.equal(reportedErrors.length, 1, 'expected async disposer rejection to be reported');
  assert.equal(reportedErrors[0], asyncCloseError, 'expected original async close error to be reported');
  assert.equal(unhandledRejections.length, 0, 'expected async disposer rejection to be handled');
  await registry.close();
} finally {
  process.off('unhandledRejection', onUnhandledRejection);
}

console.log('lifecycle disposer async close test passed');

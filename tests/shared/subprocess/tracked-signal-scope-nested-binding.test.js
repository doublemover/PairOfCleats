#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  trackedOwnershipIdByAbortSignal,
  withTrackedSubprocessSignalScope
} from '../../../src/shared/subprocess/tracking.js';

const controller = new AbortController();

await withTrackedSubprocessSignalScope(controller.signal, 'outer-scope', async () => {
  assert.equal(
    trackedOwnershipIdByAbortSignal.get(controller.signal),
    'outer-scope',
    'expected outer scope binding to be visible during outer operation'
  );

  await withTrackedSubprocessSignalScope(controller.signal, 'inner-scope', async () => {
    assert.equal(
      trackedOwnershipIdByAbortSignal.get(controller.signal),
      'inner-scope',
      'expected inner scope binding to shadow outer scope during nested operation'
    );
  });

  assert.equal(
    trackedOwnershipIdByAbortSignal.get(controller.signal),
    'outer-scope',
    'expected outer scope binding to be restored after nested operation completes'
  );
});

assert.equal(
  trackedOwnershipIdByAbortSignal.get(controller.signal),
  undefined,
  'expected signal binding to be removed once scoped operation completes'
);

console.log('tracked signal scope nested binding test passed');

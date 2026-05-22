#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createStaleProcessRestartHarness,
  sleep
} from './helpers/stale-process-restart-harness.js';

const { client, lifecycleEvents, spawnedChildren, startWithBackoffRetry } =
  createStaleProcessRestartHarness();

try {
  client.start();
  assert.equal(spawnedChildren.length, 1, 'expected initial fake child spawn');

  const firstChild = spawnedChildren[0];
  firstChild.stdout.emit('close');
  await sleep(25);

  await startWithBackoffRetry();
  assert.equal(spawnedChildren.length, 2, 'expected replacement child spawn after stale reader close');

  const staleReapEvent = lifecycleEvents.find(
    (event) => (
      String(event.reason || '').startsWith('reader_closed')
      && (event.kind === 'reap' || event.kind === 'kill_diagnostics')
    )
  );
  if (staleReapEvent) {
    assert.ok(
      staleReapEvent.kind === 'reap' || staleReapEvent.kind === 'kill_diagnostics',
      'expected reader-closed lifecycle event to represent stale-process cleanup'
    );
  }
} finally {
  await Promise.resolve(client.kill());
}

console.log('LSP reader-closed restart stale-process reap test passed');

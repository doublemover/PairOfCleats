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
  firstChild.stdin.emit('close');
  await sleep(25);

  await startWithBackoffRetry();
  assert.equal(spawnedChildren.length, 2, 'expected replacement child spawn after stale writer close');
  assert.ok(
    firstChild.killed || firstChild.exitCode !== null || firstChild.signalCode !== null,
    'expected stale writer-closed child to be considered terminated before restart'
  );

  const staleReapEvent = lifecycleEvents.find(
    (event) => (
      String(event.reason || '').startsWith('writer_closed')
      && (event.kind === 'reap' || event.kind === 'kill_diagnostics')
    )
  );
  if (staleReapEvent) {
    assert.ok(
      staleReapEvent.kind === 'reap' || staleReapEvent.kind === 'kill_diagnostics',
      'expected writer-closed lifecycle event to represent stale-process cleanup'
    );
  }
} finally {
  await Promise.resolve(client.kill());
}

console.log('LSP writer-closed restart stale-process reap test passed');

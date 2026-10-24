#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createStaleProcessRestartHarness
} from './helpers/stale-process-restart-harness.js';

const { client, lifecycleEvents, spawnedChildren, startAfterSettlement } =
  createStaleProcessRestartHarness();

try {
  client.start();
  assert.equal(spawnedChildren.length, 1, 'expected initial owned child spawn');

  const firstChild = spawnedChildren[0];
  firstChild.stdin.emit('close');
  assert.throws(() => client.start(), { code: 'ERR_LSP_RESTART_STALE_PROCESS' });
  await startAfterSettlement();
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
  assert.ok(staleReapEvent, 'writer closure must trigger the actual stale-process cleanup owner');
  assert.notEqual(firstChild.exitCode ?? firstChild.signalCode, null, 'the original child has actually exited');
} finally {
  await Promise.resolve(client.kill());
  assert.equal((await client.waitForResourceSettlement()).settled, true);
}

console.log('LSP writer-closed restart stale-process reap test passed');

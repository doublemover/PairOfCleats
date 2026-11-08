#!/usr/bin/env node
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  createStaleProcessRestartHarness
} from './helpers/stale-process-restart-harness.js';

const { client, lifecycleEvents, spawnedChildren, startAfterSettlement } =
  createStaleProcessRestartHarness();

try {
  client.start();
  assert.equal(spawnedChildren.length, 1, 'expected initial owned child spawn');

  const firstChild = spawnedChildren[0];
  // A synthetic close double-counts Node's native stdio close bookkeeping and
  // can emit child.close before exit. Close the actual transport instead.
  const readerClosed = once(firstChild.stdout, 'close');
  firstChild.stdout.destroy();
  await readerClosed;
  assert.throws(() => client.start(), { code: 'ERR_LSP_RESTART_STALE_PROCESS' });
  await startAfterSettlement();
  assert.equal(spawnedChildren.length, 2, 'expected replacement child spawn after stale reader close');

  const staleReapEvent = lifecycleEvents.find(
    (event) => (
      String(event.reason || '').startsWith('reader_closed')
      && (event.kind === 'reap' || event.kind === 'kill_diagnostics')
    )
  );
  assert.ok(staleReapEvent, 'reader closure must trigger the actual stale-process cleanup owner');
  assert.notEqual(firstChild.exitCode ?? firstChild.signalCode, null, 'the original child has actually exited');
} finally {
  await Promise.resolve(client.kill());
  assert.equal((await client.waitForResourceSettlement()).settled, true);
}

console.log('LSP reader-closed restart stale-process reap test passed');

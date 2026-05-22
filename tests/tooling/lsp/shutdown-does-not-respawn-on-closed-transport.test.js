#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { sleep } from '../../../src/shared/sleep.js';
import { createTrackedFakeChildProcessSpawner } from './helpers/fake-child-process.js';

const { spawnedChildren, spawnProcess } = createTrackedFakeChildProcessSpawner();
const client = createLspClient({
  cmd: 'fake-lsp',
  args: ['--stdio'],
  log: () => {},
  spawnProcess
});

try {
  client.start();
  assert.equal(spawnedChildren.length, 1, 'expected initial fake child spawn');
  const firstChild = spawnedChildren[0];
  firstChild.stdin.emit('close');
  await sleep(20);

  await client.shutdownAndExit();
  await sleep(50);

  assert.equal(
    spawnedChildren.length,
    1,
    'expected shutdown on closed transport to avoid spawning a replacement process'
  );
} finally {
  await Promise.resolve(client.kill());
}

console.log('LSP shutdown closed-transport no-respawn test passed');

import { createLspClient } from '../../../../src/integrations/tooling/lsp/client.js';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

export const createStaleProcessRestartHarness = () => {
  const lifecycleEvents = [];
  const spawnedChildren = [];
  const client = createLspClient({
    cmd: process.execPath,
    args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000);'],
    log: () => {},
    onLifecycleEvent: (event) => lifecycleEvents.push(event),
    spawnProcess: (command, args, options) => {
      const child = spawn(command, args, options);
      spawnedChildren.push(child);
      return child;
    }
  });

  const startAfterSettlement = async () => {
    assert.equal((await client.waitForResourceSettlement()).settled, true,
      'actual child close and original tree cleanup must both finish before restart');
    return client.start();
  };

  return {
    client,
    lifecycleEvents,
    spawnedChildren,
    startAfterSettlement
  };
};

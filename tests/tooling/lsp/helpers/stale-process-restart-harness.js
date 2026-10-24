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
    spawnProcess: ({ cmd, args, options }) => {
      const child = spawn(cmd, args, options);
      spawnedChildren.push(child);
      return child;
    }
  });

  const startAfterSettlement = async () => {
    assert.equal((await client.waitForResourceSettlement()).settled, true,
      'actual child close and original tree cleanup must both finish before restart');
    const backoff = lifecycleEvents.findLast(event => event.backoffMs > 0);
    const remaining = backoff ? Math.max(0, backoff.at + backoff.backoffMs - Date.now()) : 0;
    if (remaining) await new Promise(resolve => setTimeout(resolve, remaining));
    return client.start();
  };

  return {
    client,
    lifecycleEvents,
    spawnedChildren,
    startAfterSettlement
  };
};

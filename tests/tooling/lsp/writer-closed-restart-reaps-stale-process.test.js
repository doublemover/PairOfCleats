#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { sleep } from '../../../src/shared/sleep.js';

class FakeChildProcess extends EventEmitter {
  constructor() {
    super();
    this.pid = 0;
    this.killed = false;
    this.exitCode = null;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killCalls = 0;
  }

  kill(signal = null) {
    this.killCalls += 1;
    this.killed = true;
    this.exitCode = this.exitCode === null ? 0 : this.exitCode;
    queueMicrotask(() => {
      this.emit('exit', this.exitCode, signal);
      this.emit('close', this.exitCode, signal);
    });
    return true;
  }

  unref() {}
}

const spawnedChildren = [];
const lifecycleEvents = [];
const client = createLspClient({
  cmd: 'fake-lsp',
  args: ['--stdio'],
  log: () => {},
  onLifecycleEvent: (event) => lifecycleEvents.push(event),
  spawnProcess: () => {
    const child = new FakeChildProcess();
    spawnedChildren.push(child);
    return child;
  }
});

const startWithBackoffRetry = async (attempts = 8) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      client.start();
      return;
    } catch (error) {
      if (!String(error?.message || '').includes('LSP start backoff active')) {
        throw error;
      }
      await sleep(50);
    }
  }
  throw new Error('Timed out waiting for LSP restart backoff window.');
};

try {
  client.start();
  assert.equal(spawnedChildren.length, 1, 'expected initial fake child spawn');

  const firstChild = spawnedChildren[0];
  firstChild.stdin.emit('close');
  await sleep(25);

  assert.equal(firstChild.killCalls, 1, 'expected stale writer-closed child to be explicitly killed');

  await startWithBackoffRetry();
  assert.equal(spawnedChildren.length, 2, 'expected replacement child spawn after stale writer close');

  const reapEvent = lifecycleEvents.find(
    (event) => event.kind === 'reap' && String(event.reason || '').startsWith('writer_closed')
  );
  assert.ok(reapEvent, 'expected writer-closed reap lifecycle event');
} finally {
  client.kill();
}

console.log('LSP writer-closed restart stale-process reap test passed');

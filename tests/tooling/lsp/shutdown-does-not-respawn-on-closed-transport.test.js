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
  }

  kill(signal = null) {
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
const client = createLspClient({
  cmd: 'fake-lsp',
  args: ['--stdio'],
  log: () => {},
  spawnProcess: () => {
    const child = new FakeChildProcess();
    spawnedChildren.push(child);
    return child;
  }
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

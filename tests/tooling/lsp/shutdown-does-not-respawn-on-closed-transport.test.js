#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { createFramedJsonRpcParser } from '../../../src/shared/jsonrpc.js';
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

const sendServerMessage = (child, message) => {
  const payload = JSON.stringify(message);
  child.stdout.emit('data', Buffer.from(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`));
};

const waitForMessage = (child, messages, method) => {
  const existing = messages.find((message) => message.method === method);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message.method !== method) return;
      clearTimeout(timer);
      child.off('test:outbound-message', onMessage);
      resolve(message);
    };
    const timer = setTimeout(() => {
      child.off('test:outbound-message', onMessage);
      reject(new Error(`Timed out waiting for fake LSP ${method} message.`));
    }, 1000);
    child.on('test:outbound-message', onMessage);
  });
};

const runRestartDuringShutdownCase = async ({ respondBeforeRestart }) => {
  const messagesByChild = new Map();
  const { spawnedChildren: children, spawnProcess: spawnFake } = createTrackedFakeChildProcessSpawner({
    configureChild: (child) => {
      child.signalCode = null;
      const messages = [];
      messagesByChild.set(child, messages);
      const outboundParser = createFramedJsonRpcParser({
        onMessage: (message) => {
          messages.push(message);
          child.emit('test:outbound-message', message);
        }
      });
      child.stdin.on('data', (chunk) => outboundParser.push(chunk));
    }
  });
  const fakeClient = createLspClient({ cmd: 'fake-lsp', spawnProcess: spawnFake });
  let shuttingDown;
  try {
    const original = fakeClient.start();
    let shutdownSettled = false;
    shuttingDown = fakeClient.shutdownAndExit().then(() => { shutdownSettled = true; });
    const shutdownRequest = await waitForMessage(original, messagesByChild.get(original), 'shutdown');
    if (respondBeforeRestart) {
      sendServerMessage(original, { jsonrpc: '2.0', id: shutdownRequest.id, result: null });
    }
    original.exitCode = 0;
    const killing = fakeClient.kill();
    const replacement = fakeClient.start();
    const response = fakeClient.request('test/replacement', null, { timeoutMs: 1000 })
      .then((value) => ({ value }), (error) => ({ error }));
    await killing;
    const requestMessage = await waitForMessage(replacement, messagesByChild.get(replacement), 'test/replacement');

    assert.equal(shutdownSettled, true, 'expected old shutdown not to wait for the replacement process');
    assert.equal(replacement.listenerCount('exit'), 1, 'expected no shutdown wait listener on the replacement');
    assert.equal(
      fakeClient.notify('test/still-running', null, { startIfNeeded: false }),
      true,
      'expected old shutdown not to kill the replacement transport'
    );
    await waitForMessage(replacement, messagesByChild.get(replacement), 'test/still-running');
    assert.equal(
      messagesByChild.get(replacement).some((message) => message.method === 'exit'),
      false,
      'expected old shutdown not to send exit to the replacement process'
    );
    sendServerMessage(replacement, { jsonrpc: '2.0', id: requestMessage.id, result: 'alive' });
    assert.deepEqual(await response, { value: 'alive' }, 'expected replacement requests to remain live');
    assert.equal(children.length, 2, 'expected only the explicitly requested replacement');
    await shuttingDown;
  } finally {
    for (const child of children) {
      child.exitCode = 0;
      child.emit('exit', 0, null);
    }
    await fakeClient.kill();
    await shuttingDown;
  }
};

const runLiveShutdownCase = async () => {
  const messages = [];
  const { spawnedChildren: children, spawnProcess: spawnFake } = createTrackedFakeChildProcessSpawner({
    configureChild: (child) => {
      child.signalCode = null;
      const outboundParser = createFramedJsonRpcParser({
        onMessage: (message) => {
          messages.push(message);
          if (message.method === 'shutdown') {
            sendServerMessage(child, { jsonrpc: '2.0', id: message.id, result: null });
          } else if (message.method === 'exit') {
            child.exitCode = 0;
            child.emit('exit', 0, null);
          }
        }
      });
      child.stdin.on('data', (chunk) => outboundParser.push(chunk));
    }
  });
  const fakeClient = createLspClient({ cmd: 'fake-lsp', spawnProcess: spawnFake });
  try {
    fakeClient.start();
    await fakeClient.shutdownAndExit();
    await fakeClient.shutdownAndExit();
    assert.deepEqual(messages.map((message) => message.method), ['shutdown', 'exit']);
    assert.equal(children.length, 1, 'expected ordinary shutdown to preserve its no-respawn behavior');
  } finally {
    for (const child of children) child.exitCode = 0;
    await fakeClient.kill();
  }
};

await runRestartDuringShutdownCase({ respondBeforeRestart: false });
await runRestartDuringShutdownCase({ respondBeforeRestart: true });
await runLiveShutdownCase();

console.log('LSP shutdown closed-transport no-respawn test passed');

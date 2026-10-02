#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { closeJsonRpcWriter, createFramedJsonRpcParser } from '../../../src/shared/jsonrpc.js';
import { getTrackedSubprocessCount } from '../../../src/shared/subprocess/tracking.js';
import { sleep } from '../../../src/shared/sleep.js';
import { countNonEmptyLines } from '../../helpers/lsp-signature-fixtures.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createTrackedFakeChildProcessSpawner } from './helpers/fake-child-process.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'lsp-generation');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const counterPath = path.join(tempRoot, 'spawn-counter.txt');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');

const countSpawns = async () => countNonEmptyLines(counterPath);

const waitForSpawns = async (expected, timeoutMs = 2000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await countSpawns() >= expected) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${expected} LSP spawn(s).`);
};

const client = createLspClient({
  cmd: process.execPath,
  args: [serverPath],
  env: applyTestEnv({
    syncProcess: false,
    extraEnv: { POC_LSP_COUNTER: counterPath }
  }),
  log: () => {}
});

try {
  client.start();
  await waitForSpawns(1);
  await Promise.resolve(client.kill());
  client.start();
  await waitForSpawns(2);

  await client.initialize({ rootUri: pathToFileURL(tempRoot).href });
  await client.shutdownAndExit();
  await sleep(100);
} finally {
  await Promise.resolve(client.kill());
}

await sleep(200);
assert.equal(
  getTrackedSubprocessCount(),
  0,
  'expected tracked subprocess registry to be empty after restart/kill sequence'
);

const spawns = await countSpawns();
assert.equal(spawns, 2, 'expected only two LSP spawns after restart');

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

const sendServerMessage = (child, message) => {
  const payload = JSON.stringify(message);
  child.stdout.emit('data', Buffer.from(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`));
};

const createFakeClient = (options = {}) => {
  const messagesByChild = new Map();
  const { spawnedChildren, spawnProcess } = createTrackedFakeChildProcessSpawner({
    configureChild: (child) => {
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
  return {
    client: createLspClient({ cmd: 'fake-lsp', spawnProcess, ...options }),
    spawnedChildren,
    messagesByChild,
    waitForMessage: (child, predicate) => {
      const existing = messagesByChild.get(child).find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const onMessage = (message) => {
          if (!predicate(message)) return;
          clearTimeout(timer);
          child.off('test:outbound-message', onMessage);
          resolve(message);
        };
        const timer = setTimeout(() => {
          child.off('test:outbound-message', onMessage);
          reject(new Error('Timed out waiting for fake LSP outbound message.'));
        }, 1000);
        child.on('test:outbound-message', onMessage);
      });
    }
  };
};

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const runLateWriteFailureCase = async () => {
  const { client: fakeClient, spawnedChildren, waitForMessage } = createFakeClient();
  try {
    fakeClient.notify('test/old', null);
    // The old write is queued, so closing it here rejects only after the restart.
    const killing = fakeClient.kill();
    const response = fakeClient.request('test/current', null, { timeoutMs: 1000 })
      .then((value) => ({ value }), (error) => ({ error }));
    const replacement = spawnedChildren[1];
    await killing;
    const requestMessage = await waitForMessage(replacement, (message) => message.method === 'test/current');

    assert.equal(
      fakeClient.notify('test/still-running', null, { startIfNeeded: false }),
      true,
      'expected a stale write rejection not to close the replacement writer'
    );
    sendServerMessage(replacement, { jsonrpc: '2.0', id: requestMessage.id, result: 'current result' });
    assert.deepEqual(await response, { value: 'current result' }, 'expected replacement pending requests to survive');
    assert.equal(spawnedChildren.length, 2, 'expected no extra restart after the stale write rejection');
  } finally {
    await fakeClient.kill();
  }
};

const runCurrentWriteFailureCase = async () => {
  const { client: fakeClient, spawnedChildren } = createFakeClient();
  try {
    fakeClient.start();
    closeJsonRpcWriter(spawnedChildren[0].stdin);
    await assert.rejects(
      fakeClient.request('test/closed-writer', null, { timeoutMs: 1000 }),
      { code: 'ERR_LSP_TRANSPORT_CLOSED' },
      'expected current-generation write failures to reject pending requests'
    );
    assert.equal(fakeClient.notify('test/closed', null, { startIfNeeded: false }), false);
  } finally {
    await fakeClient.kill();
  }
};

const runDeferredServerRepliesCase = async () => {
  const oldSuccess = createDeferred();
  const oldFailure = createDeferred();
  const { client: fakeClient, spawnedChildren, messagesByChild, waitForMessage } = createFakeClient({
    onRequest: async (message) => {
      if (message.method === 'test/old-success') return oldSuccess.promise;
      if (message.method === 'test/old-failure') return oldFailure.promise;
      if (message.method === 'test/current-failure') throw new Error('current failure');
      return 'current success';
    }
  });
  try {
    const original = fakeClient.start();
    sendServerMessage(original, { jsonrpc: '2.0', id: 11, method: 'test/old-success' });
    sendServerMessage(original, { jsonrpc: '2.0', id: 12, method: 'test/old-failure' });
    const killing = fakeClient.kill();
    const replacement = fakeClient.start();
    await killing;

    // Servers may reuse request IDs after a restart.
    sendServerMessage(replacement, { jsonrpc: '2.0', id: 11, method: 'test/current-success' });
    sendServerMessage(replacement, { jsonrpc: '2.0', id: 12, method: 'test/current-failure' });
    await waitForMessage(replacement, (message) => message.id === 12);
    const expectedReplies = [
      { jsonrpc: '2.0', id: 11, result: 'current success' },
      { jsonrpc: '2.0', id: 12, error: { code: -32603, message: 'current failure' } }
    ];
    assert.deepEqual(messagesByChild.get(replacement), expectedReplies, 'expected live result and error replies');

    oldSuccess.resolve('stale success');
    oldFailure.reject(new Error('stale failure'));
    await flushAsyncWork();
    fakeClient.notify('test/barrier', null, { startIfNeeded: false });
    await waitForMessage(replacement, (message) => message.method === 'test/barrier');
    assert.deepEqual(
      messagesByChild.get(replacement).filter((message) => message.method !== 'test/barrier'),
      expectedReplies,
      'expected no replies from stale handlers'
    );
    assert.deepEqual(messagesByChild.get(original), [], 'expected no writes to the closed original transport');
    assert.equal(spawnedChildren.length, 2);
  } finally {
    await fakeClient.kill();
  }
};

const runInitializeContinuationCase = async ({ restart = false, close = false } = {}) => {
  const { client: fakeClient, spawnedChildren, messagesByChild, waitForMessage } = createFakeClient();
  try {
    const initialized = fakeClient.initialize({ rootUri: 'file:///fake', timeoutMs: 1000 })
      .then((value) => ({ value }), (error) => ({ error }));
    const original = spawnedChildren[0];
    const initializeRequest = await waitForMessage(original, (message) => message.method === 'initialize');
    const result = { capabilities: { documentSymbolProvider: true } };
    sendServerMessage(original, { jsonrpc: '2.0', id: initializeRequest.id, result });
    if (close) {
      const killing = fakeClient.kill();
      if (restart) fakeClient.start();
      await killing;
    }
    const outcome = await initialized;
    if (close) {
      assert.equal(outcome.error?.code, 'ERR_LSP_TRANSPORT_CLOSED', 'expected stale initialization to reject');
      assert.equal(
        spawnedChildren.length,
        restart ? 2 : 1,
        'expected stale initialization not to spawn a new process'
      );
      if (restart) {
        fakeClient.notify('test/barrier', null, { startIfNeeded: false });
        await waitForMessage(spawnedChildren[1], (message) => message.method === 'test/barrier');
      }
      for (const messages of messagesByChild.values()) {
        assert.equal(messages.some((message) => message.method === 'initialized'), false);
      }
    } else {
      assert.deepEqual(outcome, { value: result }, 'expected live initialization to preserve its result');
      await waitForMessage(original, (message) => message.method === 'initialized');
      assert.equal(
        messagesByChild.get(original).filter((message) => message.method === 'initialized').length,
        1,
        'expected live initialization to notify its own server'
      );
    }
  } finally {
    await fakeClient.kill();
  }
};

await runLateWriteFailureCase();
await runCurrentWriteFailureCase();
await runDeferredServerRepliesCase();
await runInitializeContinuationCase();
await runInitializeContinuationCase({ close: true });
await runInitializeContinuationCase({ close: true, restart: true });

const startupError = new Error('initialize startup failed');
const failedClient = createLspClient({
  cmd: 'fake-lsp',
  spawnProcess: () => { throw startupError; }
});
await assert.rejects(failedClient.initialize(), (error) => error === startupError);

console.log('LSP generation safety test passed');

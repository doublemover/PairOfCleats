#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { startMcpServer } from '../../helpers/mcp-client.js';

applyTestEnv();
const root = process.cwd();

const initializeServer = async (session, id) => {
  session.send({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {} }
  });
  await session.readMessage();
};

const shutdownServer = async (session, id) => {
  session.send({ jsonrpc: '2.0', id, method: 'shutdown' });
  await session.readMessage();
  session.send({ jsonrpc: '2.0', method: 'exit' });
};

const parseToolErrorPayload = (response) => {
  const payloadText = response?.result?.content?.[0]?.text || '';
  try {
    return JSON.parse(payloadText || '{}');
  } catch {
    return {};
  }
};

async function runQueueTest(cacheRoot) {
  const session = await startMcpServer({
    cacheRoot,
    timeoutMs: 30000,
    env: {
      PAIROFCLEATS_MCP_QUEUE_MAX: '1'
    }
  });
  try {
    await initializeServer(session, 1);

    session.send({
      jsonrpc: '2.0',
      id: 0,
      method: 'tools/list',
      params: {}
    });
    const idZeroResponse = await session.readMessage();
    if (idZeroResponse?.id !== 0) {
      throw new Error('Expected MCP response to preserve id=0');
    }

    session.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'index_status', arguments: { repoPath: root } }
    });
    session.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'index_status', arguments: { repoPath: root } }
    });

    const first = await session.readMessage();
    const second = await session.readMessage();
    const responses = [first, second];
    const overload = responses.find((msg) => msg?.error?.code === -32001);
    if (!overload || overload.error?.data?.code !== 'QUEUE_OVERLOADED') {
      throw new Error('Expected queue overload error response.');
    }

    await shutdownServer(session, 4);
  } finally {
    await session.shutdown();
  }
}

async function runCancelTest(cacheRoot) {
  const session = await startMcpServer({
    cacheRoot,
    timeoutMs: 30000,
    env: {
      PAIROFCLEATS_TEST_MCP_DELAY_MS: '250'
    }
  });
  try {
    await initializeServer(session, 20);

    session.send({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: { name: 'index_status', arguments: { repoPath: root } }
    });
    session.send({
      jsonrpc: '2.0',
      method: '$/cancelRequest',
      params: { id: 21 }
    });

    const response = await session.readMessage();
    const payload = parseToolErrorPayload(response);
    if (!response.result?.isError || payload.code !== 'CANCELLED') {
      throw new Error('Expected cancelled tool response.');
    }

    await shutdownServer(session, 22);
  } finally {
    await session.shutdown();
  }
}

async function runDuplicateRequestIdTest(cacheRoot) {
  const session = await startMcpServer({
    cacheRoot,
    timeoutMs: 30000,
    env: {
      PAIROFCLEATS_TEST_MCP_DELAY_MS: '250',
      PAIROFCLEATS_TEST_MCP_DELAY_TOOL_NAMES: 'index_status'
    }
  });
  try {
    await initializeServer(session, 40);

    session.send({
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: { name: 'index_status', arguments: { repoPath: root } }
    });
    session.send({
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: { name: 'index_status', arguments: { repoPath: root } }
    });
    session.send({
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: { name: 'config_status', arguments: { repoPath: root } }
    });
    session.send({
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: { name: 'config_status', arguments: { repoPath: root } }
    });

    const responses = [
      await session.readMessage(),
      await session.readMessage(),
      await session.readMessage(),
      await session.readMessage()
    ];
    const duplicateErrors = responses.filter((message) => (
      message?.error?.code === -32600
      && message.error?.data?.code === ERROR_CODES.INVALID_REQUEST
      && message.error?.data?.reason === 'duplicate-request-id'
    ));
    if (duplicateErrors.length !== 2) {
      throw new Error(`Expected two duplicate request id errors, got ${duplicateErrors.length}.`);
    }
    const states = duplicateErrors
      .map((message) => message.error?.data?.state)
      .sort();
    if (states.join(',') !== 'pending,running') {
      throw new Error(`Expected duplicate errors for pending and running requests, got ${states.join(',')}.`);
    }
    const successfulIds = responses
      .filter((message) => message?.result && !message.result?.isError)
      .map((message) => message.id)
      .sort((a, b) => a - b);
    if (successfulIds.join(',') !== '41,42') {
      throw new Error(`Expected original requests 41 and 42 to complete, got ${successfulIds.join(',')}.`);
    }

    await shutdownServer(session, 43);
  } finally {
    await session.shutdown();
  }
}

async function runProgressThrottleTest(cacheRoot) {
  const session = await startMcpServer({
    cacheRoot,
    timeoutMs: 30000,
    env: {
      PAIROFCLEATS_TEST_MCP_DELAY_MS: '250'
    }
  });
  try {
    await initializeServer(session, 30);

    session.send({
      jsonrpc: '2.0',
      id: 31,
      method: 'tools/call',
      params: { name: 'index_status', arguments: { repoPath: root } }
    });
    await session.readMessage();

    const progressCount = session.notifications
      .filter((msg) => msg?.method === 'notifications/progress')
      .length;
    if (progressCount < 1 || progressCount > 2) {
      throw new Error(`Expected throttled progress notifications (1-2), got ${progressCount}.`);
    }

    await shutdownServer(session, 32);
  } finally {
    await session.shutdown();
  }
}

async function runTimeoutTest(cacheRoot) {
  const session = await startMcpServer({
    cacheRoot,
    timeoutMs: 30000,
    env: {
      PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS: '1'
    }
  });
  try {
    await initializeServer(session, 10);

    session.send({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'index_status', arguments: { repoPath: root } }
    });
    const response = await session.readMessage();
    const payload = parseToolErrorPayload(response);
    if (!response.result?.isError || payload.code !== 'TOOL_TIMEOUT') {
      throw new Error('Expected tool timeout error response.');
    }

    await shutdownServer(session, 12);
  } finally {
    await session.shutdown();
  }
}

const cases = Object.freeze({
  queue: runQueueTest,
  cancellation: runCancelTest,
  'duplicate-request-id': runDuplicateRequestIdTest,
  'progress-throttle': runProgressThrottleTest,
  timeout: runTimeoutTest
});

export const runMcpRobustnessCase = async (name) => {
  const run = cases[name];
  if (!run) throw new Error(`Unknown MCP robustness case: ${name}`);
  const cacheRoot = resolveTestCachePath(root, 'mcp-robustness', name);
  await fsPromises.rm(cacheRoot, { recursive: true, force: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  await run(cacheRoot);
  console.log(`MCP robustness ${name} passed`);
};

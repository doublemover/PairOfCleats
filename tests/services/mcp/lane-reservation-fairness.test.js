#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { startMcpServer } from '../../helpers/mcp-client.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'mcp-lane-reservation-fairness');
const repoRoot = path.join(cacheRoot, 'repo');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
const gitInit = spawnSync('git', ['init', '-q'], { cwd: repoRoot, stdio: 'ignore' });
if (gitInit.status !== 0) {
  throw new Error('Failed to initialize temporary git repository for MCP lane reservation fairness test.');
}

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

const session = await startMcpServer({
  cacheRoot,
  timeoutMs: 30000,
  env: {
    PAIROFCLEATS_MCP_QUEUE_MAX: '3',
    PAIROFCLEATS_TEST_MCP_DELAY_MS: '400',
    PAIROFCLEATS_TEST_MCP_DELAY_TOOL_NAMES: 'search'
  }
});

try {
  await initializeServer(session, 1);

  session.send({
    jsonrpc: '2.0',
    id: 41,
    method: 'tools/call',
    params: {
      name: 'search',
      arguments: { repoPath: repoRoot, query: 'slow one' }
    }
  });
  session.send({
    jsonrpc: '2.0',
    id: 42,
    method: 'tools/call',
    params: {
      name: 'search',
      arguments: { repoPath: repoRoot, query: 'slow two' }
    }
  });
  session.send({
    jsonrpc: '2.0',
    id: 43,
    method: 'tools/call',
    params: {
      name: 'search',
      arguments: { repoPath: repoRoot, query: 'slow three' }
    }
  });
  session.send({
    jsonrpc: '2.0',
    id: 44,
    method: 'tools/call',
    params: {
      name: 'config_status',
      arguments: { repoPath: repoRoot }
    }
  });

  const responses = [];
  while (responses.length < 4) {
    const message = await session.readMessage();
    if (message?.method === 'notifications/progress') continue;
    responses.push(message);
  }

  const overloaded = responses.find((entry) => entry?.id === 43);
  if (!overloaded || overloaded?.error?.data?.code !== 'QUEUE_OVERLOADED') {
    throw new Error('Expected third slow request to be rejected by lane reservation overload policy.');
  }
  if (overloaded?.error?.data?.reason !== 'fast-lane-reserved-capacity') {
    throw new Error(`Expected reserved fast-lane overload reason, got ${overloaded?.error?.data?.reason || 'missing'}.`);
  }

  const fastResponse = responses.find((entry) => entry?.id === 44);
  if (!fastResponse?.result) {
    throw new Error('Expected fast config_status request to be admitted while slow lane reserve was saturated.');
  }

  const fastIndex = responses.findIndex((entry) => entry?.id === 44);
  const slowSuccessIndex = responses.findIndex((entry) => (
    (entry?.id === 41 || entry?.id === 42) && entry?.result
  ));
  if (fastIndex < 0 || slowSuccessIndex < 0 || fastIndex > slowSuccessIndex) {
    throw new Error('Expected fast request to complete before any admitted slow request under mixed load.');
  }

  await shutdownServer(session, 2);
} finally {
  await session.shutdown();
}

console.log('MCP lane reservation fairness test passed');

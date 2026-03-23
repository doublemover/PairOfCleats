#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { startMcpServer } from '../../helpers/mcp-client.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'mcp-fairness');
const repoRoot = path.join(cacheRoot, 'repo');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
const gitInit = spawnSync('git', ['init', '-q'], { cwd: repoRoot, stdio: 'ignore' });
if (gitInit.status !== 0) {
  throw new Error('Failed to initialize temporary git repository for MCP fairness test.');
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

const parsePayload = (response) => {
  try {
    return JSON.parse(response?.result?.content?.[0]?.text || '{}');
  } catch {
    return {};
  }
};

const session = await startMcpServer({
  cacheRoot,
  timeoutMs: 30000,
  env: {
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
      arguments: { repoPath: repoRoot, query: 'needle' }
    }
  });
  session.send({
    jsonrpc: '2.0',
    id: 42,
    method: 'tools/call',
    params: {
      name: 'config_status',
      arguments: { repoPath: repoRoot }
    }
  });

  const first = await session.readMessage();
  const second = await session.readMessage();
  if (first?.id !== 42 || second?.id !== 41) {
    throw new Error(`Expected fast config_status response before delayed search (got ${first?.id}, ${second?.id}).`);
  }

  session.send({
    jsonrpc: '2.0',
    id: 51,
    method: 'tools/call',
    params: {
      name: 'search',
      arguments: { repoPath: repoRoot, query: 'cancelled needle' }
    }
  });
  session.send({
    jsonrpc: '2.0',
    id: 52,
    method: 'tools/call',
    params: {
      name: 'config_status',
      arguments: { repoPath: repoRoot }
    }
  });
  session.send({
    jsonrpc: '2.0',
    method: '$/cancelRequest',
    params: { id: 51 }
  });

  const third = await session.readMessage();
  const fourth = await session.readMessage();
  const responses = [third, fourth];
  const configResponse = responses.find((entry) => entry?.id === 52);
  const cancelledResponse = responses.find((entry) => entry?.id === 51);
  if (!configResponse) {
    throw new Error('Expected config_status response during concurrent cancellation scenario.');
  }
  const cancelledPayload = parsePayload(cancelledResponse);
  if (!cancelledResponse?.result?.isError || cancelledPayload.code !== 'CANCELLED') {
    throw new Error('Expected cancelled search response while fast request continued.');
  }

  await shutdownServer(session, 2);
} finally {
  await session.shutdown();
}

console.log('MCP fairness test passed');

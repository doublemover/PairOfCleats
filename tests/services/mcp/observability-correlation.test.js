#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { startMcpServer } from '../../helpers/mcp-client.js';

const cacheRoot = path.join(process.cwd(), 'tests', '.cache', 'mcp-observability-correlation');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  extraEnv: {
    PAIROFCLEATS_TEST_MCP_DELAY_MS: '50'
  },
  syncProcess: false
});

const { send, readMessage, notifications, shutdown } = await startMcpServer({
  cacheRoot,
  timeoutMs: 240000,
  env
});

try {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {} }
  });
  await readMessage();

  notifications.length = 0;
  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'config_status',
      arguments: {
        repoPath: process.cwd()
      },
      _meta: {
        progressToken: 'obs-progress-token',
        correlationId: 'mcp-correlation-test',
        requestId: 'mcp-request-test'
      }
    }
  });
  const response = await readMessage();
  const payload = JSON.parse(response?.result?.content?.[0]?.text || '{}');
  assert.equal(payload?.observability?.correlation?.correlationId, 'mcp-correlation-test');
  assert.equal(payload?.observability?.correlation?.requestId, 'mcp-request-test');

  const progressEvents = notifications.filter(
    (msg) => msg.method === 'notifications/progress' && msg.params?.tool === 'config_status'
  );
  assert.ok(progressEvents.length > 0, 'expected MCP config_status progress notifications');
  assert.equal(
    progressEvents.every((msg) => msg.params?.observability?.correlation?.correlationId === 'mcp-correlation-test'),
    true,
    'expected progress notifications to preserve MCP correlation'
  );

  send({ jsonrpc: '2.0', id: 3, method: 'shutdown' });
  await readMessage();
  send({ jsonrpc: '2.0', method: 'exit' });
} finally {
  await shutdown();
}

console.log('MCP observability correlation test passed');

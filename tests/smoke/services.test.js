#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import { MCP_PROTOCOL_VERSION } from '../../src/integrations/mcp/protocol.js';
import { MCP_SCHEMA_VERSION } from '../../src/integrations/mcp/defs.js';
import { createApiRouter } from '../../tools/api/router.js';
import { startMcpServer } from '../helpers/mcp-client.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
import { cleanup, root } from './smoke-utils.js';

const cacheRoots = [
  resolveTestCachePath(root, 'mcp-protocol-init'),
  resolveTestCachePath(root, 'api-router')
];

const runMcpSmoke = async () => {
  const cacheRoot = resolveTestCachePath(root, 'mcp-protocol-init');
  const { send, readMessage, shutdown } = await startMcpServer({ cacheRoot });
  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {} }
    });
    const init = await readMessage();
    assert.equal(init.result?.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.equal(init.result?.schemaVersion, MCP_SCHEMA_VERSION);
    assert.ok(init.result?.serverInfo?.name);

    send({ jsonrpc: '2.0', id: 2, method: 'shutdown' });
    await readMessage();
    send({ jsonrpc: '2.0', method: 'exit' });
  } finally {
    await shutdown();
  }
};

const runApiRouterSmoke = async () => {
  const tempRoot = resolveTestCachePath(root, 'api-router');
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(tempRoot, { recursive: true });

  const router = createApiRouter({
    host: '127.0.0.1',
    defaultRepo: tempRoot,
    defaultOutput: 'json',
    metricsRegistry: null
  });

  const server = http.createServer((req, res) => router.handleRequest(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/missing`);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.ok(payload.code);
    assert.ok(payload.namespaceCode);
  } finally {
    server.close();
    if (typeof router.close === 'function') router.close();
  }
};

let failure = null;
try {
  await cleanup(cacheRoots);
  await runMcpSmoke();
  await runApiRouterSmoke();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  failure = error;
}
await cleanup(cacheRoots);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke services passed');

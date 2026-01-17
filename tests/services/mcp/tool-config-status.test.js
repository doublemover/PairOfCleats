#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { startMcpServer } from '../../helpers/mcp-client.js';

const cacheRoot = path.join(process.cwd(), 'tests', '.cache', 'mcp-config-status');
const emptyRepo = path.join(cacheRoot, 'empty');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(emptyRepo, { recursive: true });

const { send, readMessage, shutdown } = await startMcpServer({ cacheRoot });

try {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {} }
  });
  await readMessage();

  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'config_status',
      arguments: { repoPath: emptyRepo }
    }
  });
  const configStatus = await readMessage();
  const payload = JSON.parse(configStatus.result?.content?.[0]?.text || '{}');
  const warningCodes = new Set((payload.warnings || []).map((warning) => warning.code));
  const required = ['dictionary_missing', 'model_missing', 'sqlite_missing'];
  const missing = required.filter((code) => !warningCodes.has(code));
  if (missing.length) {
    throw new Error(`config_status missing warnings: ${missing.join(', ')}`);
  }

  send({ jsonrpc: '2.0', id: 3, method: 'shutdown' });
  await readMessage();
  send({ jsonrpc: '2.0', method: 'exit' });
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await shutdown();
}

console.log('MCP config_status tool ok.');

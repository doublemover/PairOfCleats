#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { startMcpServer } from '../../helpers/mcp-client.js';

const cacheRoot = path.join(process.cwd(), 'tests', '.cache', 'mcp-tools-list');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });

const { send, readMessage, shutdown } = await startMcpServer({ cacheRoot });

try {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {} }
  });
  await readMessage();

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const list = await readMessage();
  const toolNames = (list.result?.tools || []).map((t) => t.name);
  const required = ['index_status', 'config_status', 'clean_artifacts', 'download_dictionaries'];
  const missing = required.filter((name) => !toolNames.includes(name));
  if (missing.length) {
    throw new Error(`tools/list missing: ${missing.join(', ')}`);
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

console.log('MCP tools list ok.');

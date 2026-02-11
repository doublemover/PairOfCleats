#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { startMcpServer } from '../../helpers/mcp-client.js';

const cacheRoot = path.join(process.cwd(), 'tests', '.cache', 'mcp-build-index');
const sampleRepo = path.join(process.cwd(), 'tests', 'fixtures', 'sample');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });

const { send, readMessage, notifications, shutdown } = await startMcpServer({
  cacheRoot,
  timeoutMs: 120000
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
      name: 'build_index',
      arguments: {
        repoPath: sampleRepo,
        mode: 'code',
        incremental: false,
        sqlite: false,
        stubEmbeddings: true
      }
    }
  });
  await readMessage();

  const progressEvents = notifications.filter(
    (msg) => msg.method === 'notifications/progress' && msg.params?.tool === 'build_index'
  );
  if (!progressEvents.length) {
    throw new Error('build_index did not emit progress notifications');
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

console.log('MCP build_index progress ok.');

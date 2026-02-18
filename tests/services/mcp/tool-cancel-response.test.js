#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { startMcpServer } from '../../helpers/mcp-client.js';

const cacheRoot = path.join(process.cwd(), 'tests', '.cache', 'mcp-cancel');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });
const repoRoot = path.join(cacheRoot, 'repo');
const repoSrc = path.join(repoRoot, 'src');
await fsPromises.mkdir(repoSrc, { recursive: true });
await fsPromises.writeFile(path.join(repoSrc, 'index.js'), 'export const answer = 42;\n', 'utf8');
const gitInit = spawnSync('git', ['init', '-q'], { cwd: repoRoot, stdio: 'ignore' });
if (gitInit.status !== 0) {
  throw new Error('Failed to initialize temporary git repository for MCP cancellation test.');
}

const { send, readMessage, readAnyMessage, shutdown } = await startMcpServer({
  cacheRoot,
  mode: 'legacy',
  env: { PAIROFCLEATS_TEST_MCP_DELAY_MS: '2000' }
});
const toolCallId = 2;
let cancelled = false;

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
    id: toolCallId,
    method: 'tools/call',
    params: {
      name: 'build_index',
      arguments: {
        repoPath: repoRoot,
        mode: 'code',
        incremental: false,
        sqlite: false,
        stubEmbeddings: true
      }
    }
  });

  let response = null;
  while (!response) {
    const message = await readAnyMessage();
    if (!message) continue;
    if (message.method === 'notifications/progress'
      && message.params?.tool === 'build_index'
      && !cancelled) {
      send({
        jsonrpc: '2.0',
        method: '$/cancelRequest',
        params: { id: toolCallId }
      });
      cancelled = true;
      continue;
    }
    if (message.id === toolCallId) {
      response = message;
    }
  }

  if (!cancelled) {
    throw new Error('Expected build_index cancellation to be requested.');
  }

  const payloadText = response.result?.content?.[0]?.text || '';
  const payload = JSON.parse(payloadText || '{}');
  if (!response.result?.isError || payload.code !== ERROR_CODES.CANCELLED) {
    throw new Error('Expected cancelled response for build_index.');
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

console.log('MCP cancellation response test passed.');

#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { startMcpServer } from '../../helpers/mcp-client.js';

const cacheRoot = path.join(process.cwd(), 'tests', '.cache', 'mcp-errors');
const emptyRepo = path.join(cacheRoot, 'empty');
const missingRepo = path.join(cacheRoot, 'missing');
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
      name: 'index_status',
      arguments: { repoPath: missingRepo }
    }
  });
  const invalidRepo = await readMessage();
  if (!invalidRepo.result?.isError) {
    throw new Error('index_status missing repo should return isError');
  }
  const invalidPayload = JSON.parse(invalidRepo.result?.content?.[0]?.text || '{}');
  if (!invalidPayload.message?.includes('Repo path not found')) {
    throw new Error('index_status missing repo error payload missing message');
  }

  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'search',
      arguments: { repoPath: emptyRepo, query: 'test' }
    }
  });
  const missingIndex = await readMessage();
  if (!missingIndex.result?.isError) {
    throw new Error('search without indexes should return isError');
  }
  const missingPayload = JSON.parse(missingIndex.result?.content?.[0]?.text || '{}');
  if (!missingPayload.message?.toLowerCase().includes('index')) {
    throw new Error('search missing index error payload missing message');
  }
  const hint = missingPayload.hint || '';
  if (!hint.includes('build-index') && !hint.includes('build-sqlite-index')) {
    throw new Error('search missing index error payload missing hint');
  }

  send({ jsonrpc: '2.0', id: 4, method: 'shutdown' });
  await readMessage();
  send({ jsonrpc: '2.0', method: 'exit' });
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await shutdown();
}

console.log('MCP error handling ok.');

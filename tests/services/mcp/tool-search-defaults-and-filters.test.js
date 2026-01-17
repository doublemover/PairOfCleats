#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { startMcpServer } from '../../helpers/mcp-client.js';

const cacheRoot = path.join(process.cwd(), 'tests', '.cache', 'mcp-search');
const sampleRepo = path.join(process.cwd(), 'tests', 'fixtures', 'sample');
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

  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'search',
      arguments: {
        repoPath: sampleRepo,
        query: 'return',
        mode: 'code',
        top: 5
      }
    }
  });
  const baselineSearch = await readMessage();
  const baselinePayload = JSON.parse(baselineSearch.result?.content?.[0]?.text || '{}');
  const baselineHits = baselinePayload.code || [];
  if (!baselineHits.length) {
    throw new Error('baseline MCP search returned no results');
  }
  if (baselineHits[0]?.tokens !== undefined) {
    throw new Error('MCP search should default to compact JSON payloads');
  }

  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'search',
      arguments: {
        repoPath: sampleRepo,
        query: 'return',
        mode: 'code',
        top: 5,
        riskTag: 'sql'
      }
    }
  });
  const riskSearch = await readMessage();
  const riskPayload = JSON.parse(riskSearch.result?.content?.[0]?.text || '{}');
  const riskHits = riskPayload.code || [];
  if (riskHits.length === baselineHits.length) {
    throw new Error('riskTag filter did not change MCP search results');
  }

  send({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'search',
      arguments: {
        repoPath: sampleRepo,
        query: 'return',
        mode: 'code',
        top: 5,
        type: 'class'
      }
    }
  });
  const typeSearch = await readMessage();
  const typePayload = JSON.parse(typeSearch.result?.content?.[0]?.text || '{}');
  const typeHits = typePayload.code || [];
  if (typeHits.length === baselineHits.length) {
    throw new Error('type filter did not change MCP search results');
  }

  send({ jsonrpc: '2.0', id: 5, method: 'shutdown' });
  await readMessage();
  send({ jsonrpc: '2.0', method: 'exit' });
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await shutdown();
}

console.log('MCP search defaults and filters ok.');

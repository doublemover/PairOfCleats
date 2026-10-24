#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { startMcpServer } from '../../helpers/mcp-client.js';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const sampleRepo = path.join(process.cwd(), 'tests', 'fixtures', 'sample');
const suffix = typeof process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX === 'string'
  ? process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX.trim()
  : '';
const cacheName = suffix ? `mcp-search-${suffix}` : 'mcp-search';
const cacheRoot = resolveTestCachePath(process.cwd(), cacheName);
applyTestEnv({ cacheRoot });
await fsPromises.rm(cacheRoot, { recursive: true, force: true });

const testConfig = {
  sqlite: { use: false },
  indexing: { embeddings: { enabled: false } }
};
const envOverrides = { PAIROFCLEATS_TEST_CONFIG: JSON.stringify(testConfig) };

await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName,
  envOverrides,
  cacheScope: 'isolated',
  requiredModes: ['code']
});

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
        query: 'greet',
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

  const hitKey = (hit) => {
    if (!hit || typeof hit !== 'object') return JSON.stringify(hit);
    const file = hit.file || hit.path || hit.relPath || null;
    if (file) {
      const start = hit.startLine ?? hit.start ?? 0;
      const end = hit.endLine ?? hit.end ?? 0;
      const kind = hit.kind || '';
      const name = hit.name || '';
      return `${file}:${start}:${end}:${kind}:${name}`;
    }
    if (hit.id != null) return String(hit.id);
    return JSON.stringify(hit);
  };
  send({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'search',
      arguments: {
        repoPath: sampleRepo,
        query: 'greet',
        mode: 'code',
        top: 5,
        backend: 'memory'
      }
    }
  });
  const baselineTypeSearch = await readMessage();
  const baselineTypePayload = JSON.parse(baselineTypeSearch.result?.content?.[0]?.text || '{}');
  const baselineTypeHits = Array.isArray(baselineTypePayload.code) ? baselineTypePayload.code : [];
  if (!baselineTypeHits.length) {
    throw new Error(`baseline type MCP search returned no results: ${JSON.stringify(baselineTypePayload).slice(0, 600)}`);
  }
  const baselineTypeKeys = new Set(baselineTypeHits.map(hitKey));

  send({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: {
      name: 'search',
      arguments: {
        repoPath: sampleRepo,
        query: 'greet',
        mode: 'code',
        top: 5,
        type: 'class',
        backend: 'memory'
      }
    }
  });
  const typeSearch = await readMessage();
  const typePayload = JSON.parse(typeSearch.result?.content?.[0]?.text || '{}');
  const typeHits = Array.isArray(typePayload.code) ? typePayload.code : [];
  const typeKeys = new Set(typeHits.map(hitKey));
  let typeChanged = baselineTypeKeys.size !== typeKeys.size;
  if (!typeChanged) {
    for (const key of baselineTypeKeys) {
      if (!typeKeys.has(key)) {
        typeChanged = true;
        break;
      }
    }
  }
  if (!typeChanged) {
    throw new Error('type filter did not change MCP search results');
  }

  send({ jsonrpc: '2.0', id: 7, method: 'shutdown' });
  await readMessage();
  send({ jsonrpc: '2.0', method: 'exit' });
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await shutdown();
}

console.log('MCP search defaults and filters ok.');

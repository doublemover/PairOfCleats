#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { startMcpServer } from '../../helpers/mcp-client.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const suffix = typeof process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX === 'string'
  ? process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX.trim() : '';
const cacheName = suffix ? `mcp-search-risk-${suffix}` : 'mcp-search-risk';
const cacheRoot = resolveTestCachePath(process.cwd(), cacheName);
const fixtureRoot = resolveTestCachePath(process.cwd(), `${cacheName}-repo`);
const sourceRoot = path.join(process.cwd(), 'tests', 'fixtures', 'languages', 'src');
applyTestEnv({ cacheRoot, embeddings: 'stub', testConfig: {
  sqlite: { use: false },
  indexing: { workerPool: { enabled: false }, semantic: { enabled: false },
    embeddings: { enabled: false }, riskAnalysis: true, riskAnalysisCrossFile: true,
    typeInference: false, typeInferenceCrossFile: false }
} });
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.rm(fixtureRoot, { recursive: true, force: true });
await fs.mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
for (const name of ['javascript_risk_sink.js', 'javascript_risk_source.js']) {
  await fs.copyFile(path.join(sourceRoot, name), path.join(fixtureRoot, 'src', name));
}
await buildIndex(fixtureRoot, { mode: 'code', stage: 'stage2', 'stub-embeddings': true, 'scm-provider': 'none' });

const hitKey = hit => {
  if (!hit || typeof hit !== 'object') return JSON.stringify(hit);
  const file = hit.file || hit.path || hit.relPath || null;
  if (file) return `${file}:${hit.startLine ?? hit.start ?? 0}:${hit.endLine ?? hit.end ?? 0}:${hit.kind || ''}:${hit.name || ''}`;
  if (hit.id != null) return String(hit.id);
  return JSON.stringify(hit);
};

const { send, readMessage, shutdown } = await startMcpServer({ cacheRoot });
try {
  send({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {} } });
  await readMessage();
  const search = async (id, riskTag) => {
    send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'search', arguments: {
      repoPath: fixtureRoot, query: 'runUnsafe', mode: 'code', top: 50, backend: 'memory',
      ...(riskTag ? { riskTag } : {})
    } } });
    const response = await readMessage();
    const payload = JSON.parse(response.result?.content?.[0]?.text || '{}');
    return Array.isArray(payload.code) ? payload.code : [];
  };
  const baselineHits = await search(3);
  if (!baselineHits.length) throw new Error('baseline risk MCP search returned no results');
  const riskHits = await search(4, 'command-exec');
  if (!riskHits.length) throw new Error('riskTag filter returned no results');
  const baselineKeys = new Set(baselineHits.map(hitKey));
  for (const key of riskHits.map(hitKey)) {
    if (!baselineKeys.has(key)) throw new Error('riskTag filter returned hits not present in baseline result set');
  }
  send({ jsonrpc: '2.0', id: 7, method: 'shutdown' });
  await readMessage();
  send({ jsonrpc: '2.0', method: 'exit' });
} finally {
  await shutdown();
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
console.log('MCP riskTag filter retains only baseline search hits.');

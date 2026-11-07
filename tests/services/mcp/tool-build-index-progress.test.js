#!/usr/bin/env node
import os from 'node:os';
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { startMcpServer } from '../../helpers/mcp-client.js';

const temporaryRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-mcp-build-'));
const cacheRoot = path.join(temporaryRoot, 'cache');
const sampleRepo = path.join(temporaryRoot, 'repo');
await fsPromises.mkdir(sampleRepo);
await fsPromises.writeFile(path.join(sampleRepo, 'math.js'), 'export function sum(a, b) { return a + b; }\n');
applyTestEnv({ cacheRoot, embeddings: 'off', testConfig: {
  indexing: { scm: { provider: 'none' }, workerPool: { enabled: false }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }, sqlite: { use: false }
} });

const { send, readMessage, notifications, shutdown } = await startMcpServer({
  cacheRoot,
  timeoutMs: 30000
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
  const response = await readMessage();
  assert.ok(!response.error && !response.result?.isError, JSON.stringify(response));

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
  throw err;
} finally {
  await shutdown();
  await fsPromises.rm(temporaryRoot, { recursive: true, force: true });
}

console.log('MCP build_index progress ok.');

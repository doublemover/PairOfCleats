#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { readCurrentBuildGeneration } from '../../../src/shared/indexing/build-pointer.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { startMcpServer } from '../../helpers/mcp-client.js';

const cacheName = 'mcp-search-build-identity';
const cacheRoot = path.join(process.cwd(), 'tests', '.cache', cacheName);
await fsPromises.rm(cacheRoot, { recursive: true, force: true });

const { fixtureRoot, env, userConfig } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName,
  cacheScope: 'shared',
  requiredModes: ['code']
});

const repoCacheRoot = getRepoCacheRoot(fixtureRoot, userConfig);
const currentInfo = readCurrentBuildGeneration({
  currentJsonPath: path.join(repoCacheRoot, 'builds', 'current.json'),
  repoCacheRoot,
  buildsRoot: path.join(repoCacheRoot, 'builds')
});

const { send, readMessage, shutdown } = await startMcpServer({
  cacheRoot,
  timeoutMs: 240000,
  env
});

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
        repoPath: fixtureRoot,
        query: 'return',
        mode: 'code',
        top: 3
      }
    }
  });
  const response = await readMessage();
  const payload = JSON.parse(response?.result?.content?.[0]?.text || '{}');
  assert.equal(payload?.observability?.context?.buildId, currentInfo.buildId);
  assert.equal(
    payload?.observability?.context?.activeBuildRoot,
    currentInfo.activeRoot,
    'expected MCP search result observability to expose the active generation root'
  );
  assert.equal(
    payload?.observability?.context?.buildGenerationKey,
    currentInfo.generationKey,
    'expected MCP search result observability to expose the active generation key'
  );

  send({ jsonrpc: '2.0', id: 3, method: 'shutdown' });
  await readMessage();
  send({ jsonrpc: '2.0', method: 'exit' });
} finally {
  await shutdown();
}

console.log('MCP search build identity observability test passed');

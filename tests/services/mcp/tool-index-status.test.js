#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { startMcpServer } from '../../helpers/mcp-client.js';
import { getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { resolveRepoPath } from '../../../tools/mcp/repo.js';

const cacheRoot = path.join(process.cwd(), 'tests', '.cache', 'mcp-index-status');
const sampleRepo = path.join(process.cwd(), 'tests', 'fixtures', 'sample');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const resolvedRepo = resolveRepoPath(sampleRepo);
const userConfig = loadUserConfig(resolvedRepo);
const repoCacheRoot = getRepoCacheRoot(resolvedRepo, userConfig);
await fsPromises.mkdir(repoCacheRoot, { recursive: true });
await fsPromises.writeFile(path.join(repoCacheRoot, 'watch-state.json'), JSON.stringify({
  consistency: 'catching-up',
  quiescent: false,
  backlogDepth: 3,
  pendingReplay: true,
  lastConsistentGeneration: {
    buildId: 'watch-build-1',
    buildRoot: path.join(repoCacheRoot, 'builds', 'watch-build-1'),
    status: 'ok',
    startedAt: '2026-03-23T12:00:00.000Z',
    finishedAt: '2026-03-23T12:00:01.000Z'
  }
}, null, 2));

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
      arguments: { repoPath: sampleRepo }
    }
  });
  const status = await readMessage();
  const text = status.result?.content?.[0]?.text || '';
  const parsed = JSON.parse(text || '{}');
  if (!parsed.repoPath || !parsed.repoId) {
    throw new Error('index_status response missing repo info');
  }
  if (parsed.watch?.state?.consistency !== 'catching-up' || parsed.watch?.state?.backlogDepth !== 3) {
    throw new Error('index_status response missing persisted watch consistency state');
  }
  if (parsed.watch?.state?.lastConsistentGeneration?.buildId !== 'watch-build-1') {
    throw new Error('index_status response missing last consistent generation');
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

console.log('MCP index_status tool ok.');

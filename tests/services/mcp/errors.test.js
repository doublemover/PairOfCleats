#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { getCapabilities } from '../../../src/shared/capabilities.js';
import { startMcpServer } from '../../helpers/mcp-client.js';

const caps = getCapabilities({ refresh: true });
const modes = ['legacy'];
if (caps?.mcp?.sdk) modes.push('sdk');

for (const mode of modes) {
  const cacheRoot = path.join(process.cwd(), 'tests', '.cache', `mcp-errors-${mode}`);
  const emptyRepo = path.join(cacheRoot, 'empty');
  const missingRepo = path.join(cacheRoot, 'missing');
  await fsPromises.rm(cacheRoot, { recursive: true, force: true });
  await fsPromises.mkdir(emptyRepo, { recursive: true });

  const { send, readMessage, shutdown } = await startMcpServer({ cacheRoot, mode });

  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'pairofcleats-tests', version: '0.0.0' }
      }
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
      throw new Error(`[${mode}] index_status missing repo should return isError`);
    }
    const invalidPayload = JSON.parse(invalidRepo.result?.content?.[0]?.text || '{}');
    if (invalidPayload.code !== ERROR_CODES.INVALID_REQUEST) {
      throw new Error(`[${mode}] index_status missing repo should return INVALID_REQUEST`);
    }
    if (!invalidPayload.message?.includes('Repo path not found')) {
      throw new Error(`[${mode}] index_status missing repo error payload missing message`);
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
      console.error(`[${mode}] missing index raw response:`, JSON.stringify(missingIndex, null, 2));
      throw new Error(`[${mode}] search without indexes should return isError`);
    }
    const missingPayload = JSON.parse(missingIndex.result?.content?.[0]?.text || '{}');
    if (missingPayload.code !== ERROR_CODES.NO_INDEX) {
      console.error(`[${mode}] missing index payload:`, JSON.stringify(missingPayload, null, 2));
      throw new Error(`[${mode}] search missing index should return NO_INDEX`);
    }
    if (!missingPayload.message?.toLowerCase().includes('index')) {
      console.error(`[${mode}] missing index payload:`, JSON.stringify(missingPayload, null, 2));
      throw new Error(`[${mode}] search missing index error payload missing message`);
    }
    const hint = missingPayload.hint || '';
    if (!hint.includes('build-index') && !hint.includes('stage 4')) {
      console.error(`[${mode}] missing index payload:`, JSON.stringify(missingPayload, null, 2));
      throw new Error(`[${mode}] search missing index error payload missing hint`);
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
}

console.log('MCP error handling ok.');

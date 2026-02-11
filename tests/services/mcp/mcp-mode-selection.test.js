#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getCapabilities } from '../../../src/shared/capabilities.js';
import { startMcpServer } from '../../helpers/mcp-client.js';
import { skip } from '../../helpers/skip.js';

const caps = getCapabilities({ refresh: true });
if (!caps?.mcp?.sdk) {
  skip('Skipping MCP mode selection test; @modelcontextprotocol/sdk not available.');
}

const MODE_CASE_TIMEOUT_MS = 30000;

const readWithTimeout = (promise, label) => {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), MODE_CASE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
};

const runCase = async ({ label, expectedMode, cliMode, env }) => {
  const cacheRoot = path.join(process.cwd(), 'tests', '.cache', `mcp-mode-${label}`);
  await fsPromises.rm(cacheRoot, { recursive: true, force: true });
  const { send, readMessage, shutdown } = await startMcpServer({
    cacheRoot,
    mode: cliMode,
    transport: expectedMode,
    env
  });

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
    const init = await readWithTimeout(readMessage(), `${label} initialize`);
    if (!init?.result?.protocolVersion) {
      throw new Error(`${label} expected initialize response from ${expectedMode} mode.`);
    }
    send({ jsonrpc: '2.0', id: 2, method: 'shutdown' });
    await readWithTimeout(readMessage(), `${label} shutdown`);
    send({ jsonrpc: '2.0', method: 'exit' });
  } finally {
    await shutdown();
  }
};

await runCase({
  label: 'cli-over-env',
  expectedMode: 'sdk',
  cliMode: 'sdk',
  env: {
    PAIROFCLEATS_MCP_MODE: 'legacy'
  }
});

await runCase({
  label: 'env-over-config',
  expectedMode: 'sdk',
  cliMode: null,
  env: {
    PAIROFCLEATS_MCP_MODE: 'sdk',
    PAIROFCLEATS_TEST_CONFIG: JSON.stringify({ mcp: { mode: 'legacy' } })
  }
});

await runCase({
  label: 'config-only',
  expectedMode: 'legacy',
  cliMode: null,
  env: {
    PAIROFCLEATS_TEST_CONFIG: JSON.stringify({ mcp: { mode: 'legacy' } })
  }
});

console.log('MCP mode selection ok.');

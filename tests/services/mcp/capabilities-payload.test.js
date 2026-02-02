#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { MCP_SCHEMA_VERSION } from '../../../src/integrations/mcp/defs.js';
import { getCapabilities } from '../../../src/shared/capabilities.js';
import { startMcpServer } from '../../helpers/mcp-client.js';

const caps = getCapabilities({ refresh: true });
const modes = ['legacy'];
if (caps?.mcp?.sdk) modes.push('sdk');

for (const mode of modes) {
  const cacheRoot = path.join(process.cwd(), 'tests', '.cache', `mcp-capabilities-${mode}`);
  await fsPromises.rm(cacheRoot, { recursive: true, force: true });

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
    const init = await readMessage();
    const result = init.result || {};
    if (!result.schemaVersion) {
      throw new Error(`[${mode}] initialize missing schemaVersion.`);
    }
    if (result.schemaVersion !== MCP_SCHEMA_VERSION) {
      throw new Error(`[${mode}] initialize schemaVersion mismatch.`);
    }
    if (!result.toolVersion) {
      throw new Error(`[${mode}] initialize missing toolVersion.`);
    }
    if (!result.capabilities?.experimental?.pairofcleats?.capabilities) {
      throw new Error(`[${mode}] initialize missing capabilities payload.`);
    }

    send({ jsonrpc: '2.0', id: 2, method: 'shutdown' });
    await readMessage();
    send({ jsonrpc: '2.0', method: 'exit' });
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  } finally {
    await shutdown();
  }
}

console.log('MCP initialize capabilities ok.');

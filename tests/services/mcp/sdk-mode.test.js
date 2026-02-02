#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { MCP_SCHEMA_VERSION } from '../../../src/integrations/mcp/defs.js';
import { getCapabilities } from '../../../src/shared/capabilities.js';
import { skip } from '../../helpers/skip.js';

const caps = getCapabilities({ refresh: true });
if (!caps?.mcp?.sdk) {
  skip('Skipping SDK MCP test; @modelcontextprotocol/sdk not available.');
}

const cacheRoot = path.join(process.cwd(), 'tests', '.cache', 'mcp-sdk-mode');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });

const serverPath = path.join(process.cwd(), 'tools', 'mcp-server.js');
const server = spawn(process.execPath, [serverPath, '--mcp-mode', 'sdk'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    PAIROFCLEATS_TESTING: '1',
    PAIROFCLEATS_HOME: cacheRoot,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot
  }
});

const createLineReader = (stream) => {
  let buffer = '';
  const readMessage = async () => new Promise((resolve) => {
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const idx = buffer.indexOf('\n');
      if (idx === -1) return;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) return;
      stream.off('data', onData);
      resolve(JSON.parse(line));
    };
    stream.on('data', onData);
  });
  return { readMessage };
};

const { readMessage } = createLineReader(server.stdout);
const timeout = setTimeout(() => {
  console.error('MCP SDK server test timed out.');
  server.kill('SIGKILL');
  process.exit(1);
}, 30000);

const send = (payload) => {
  server.stdin.write(`${JSON.stringify(payload)}\n`);
};

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
  if (!init.result?.schemaVersion) {
    throw new Error('SDK initialize missing schemaVersion.');
  }
  if (init.result?.schemaVersion !== MCP_SCHEMA_VERSION) {
    throw new Error('SDK initialize schemaVersion mismatch.');
  }
  if (!init.result?.toolVersion) {
    throw new Error('SDK initialize missing toolVersion.');
  }
  if (!init.result?.capabilities?.experimental?.pairofcleats?.capabilities) {
    throw new Error('SDK initialize missing capabilities payload.');
  }

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const list = await readMessage();
  const toolNames = (list.result?.tools || []).map((t) => t.name);
  if (!toolNames.includes('index_status')) {
    throw new Error('SDK tools/list missing index_status.');
  }

  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'index_status', arguments: {} }
  });
  const callResult = await readMessage();
  if (!Array.isArray(callResult.result?.content)) {
    throw new Error('SDK tools/call missing content.');
  }

  const missingRepo = path.join(cacheRoot, 'missing');
  send({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'index_status', arguments: { repoPath: missingRepo } }
  });
  const missing = await readMessage();
  const missingPayload = JSON.parse(missing.result?.content?.[0]?.text || '{}');
  if (!missing.result?.isError || missingPayload.code !== 'INVALID_REQUEST') {
    throw new Error('SDK error payload should include INVALID_REQUEST code.');
  }

  send({ jsonrpc: '2.0', id: 5, method: 'shutdown' });
  await readMessage();
  send({ jsonrpc: '2.0', method: 'exit' });
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  clearTimeout(timeout);
  server.stdin.end();
  server.kill('SIGTERM');
}

console.log('MCP SDK mode ok.');

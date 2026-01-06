#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getToolDefs } from '../src/integrations/mcp/defs.js';
import { stableStringify } from '../src/shared/stable-json.js';
import { DEFAULT_MODEL_ID } from '../tools/dict-utils.js';

const root = process.cwd();
const serverPath = path.join(root, 'tools', 'mcp-server.js');
const sampleRepo = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, 'tests', '.cache', 'mcp-schema');
const cacheRoot = path.join(tempRoot, 'cache');
const emptyRepo = path.join(tempRoot, 'empty');
const snapshotPath = path.join(root, 'tests', 'fixtures', 'mcp', 'schema-snapshot.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(emptyRepo, { recursive: true });

function encodeMessage(payload) {
  const json = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
}

function createReader(stream) {
  let buffer = Buffer.alloc(0);
  const tryRead = () => {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return null;
    const header = buffer.slice(0, headerEnd).toString('utf8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      return null;
    }
    const length = parseInt(match[1], 10);
    const total = headerEnd + 4 + length;
    if (buffer.length < total) return null;
    const body = buffer.slice(headerEnd + 4, total).toString('utf8');
    buffer = buffer.slice(total);
    return JSON.parse(body);
  };
  const notifications = [];
  const readRaw = async () => {
    const existing = tryRead();
    if (existing) return existing;
    return new Promise((resolve) => {
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const parsed = tryRead();
        if (!parsed) return;
        stream.off('data', onData);
        resolve(parsed);
      };
      stream.on('data', onData);
    });
  };
  const readMessage = async () => {
    while (true) {
      const parsed = await readRaw();
      if (parsed && parsed.method && parsed.id === undefined) {
        notifications.push(parsed);
        continue;
      }
      return parsed;
    }
  };
  return { readMessage, notifications };
}

const server = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    PAIROFCLEATS_HOME: cacheRoot,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot
  }
});

const { readMessage } = createReader(server.stdout);
const timeout = setTimeout(() => {
  console.error('MCP schema test timed out.');
  server.kill('SIGKILL');
  process.exit(1);
}, 30000);

function send(payload) {
  server.stdin.write(encodeMessage(payload));
}

const shapeValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => shapeValue(entry));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = shapeValue(value[key]);
    }
    return out;
  }
  if (value === null) return '<null>';
  return `<${typeof value}>`;
};

const toolSchemaSnapshot = getToolDefs(DEFAULT_MODEL_ID).map((tool) => ({
  name: tool.name,
  required: Array.isArray(tool.inputSchema?.required)
    ? [...tool.inputSchema.required].sort()
    : [],
  properties: Object.keys(tool.inputSchema?.properties || {}).sort()
}));

async function run() {
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
  const statusText = status.result?.content?.[0]?.text || '';
  const statusPayload = JSON.parse(statusText || '{}');

  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'config_status',
      arguments: { repoPath: emptyRepo }
    }
  });
  const configStatus = await readMessage();
  const configText = configStatus.result?.content?.[0]?.text || '';
  const configPayload = JSON.parse(configText || '{}');

  send({ jsonrpc: '2.0', id: 4, method: 'shutdown' });
  await readMessage();
  send({ jsonrpc: '2.0', method: 'exit' });

  return {
    tools: toolSchemaSnapshot,
    responses: {
      index_status: shapeValue(statusPayload),
      config_status: shapeValue(configPayload)
    }
  };
}

run()
  .then(async (actual) => {
    clearTimeout(timeout);
    server.stdin.end();
    const expectedRaw = await fsPromises.readFile(snapshotPath, 'utf8');
    const expected = JSON.parse(expectedRaw);
    if (stableStringify(actual) !== stableStringify(expected)) {
      console.error('MCP schema snapshot mismatch.');
      process.exit(1);
    }
    console.log('MCP schema snapshot test passed');
  })
  .catch((err) => {
    clearTimeout(timeout);
    console.error(err?.message || err);
    server.kill('SIGKILL');
    process.exit(1);
  });

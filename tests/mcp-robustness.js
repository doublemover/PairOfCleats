#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const serverPath = path.join(root, 'tools', 'mcp-server.js');
const tempRoot = path.join(root, 'tests', '.cache', 'mcp-robustness');
const queueCache = path.join(tempRoot, 'queue-cache');
const timeoutCache = path.join(tempRoot, 'timeout-cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(queueCache, { recursive: true });
await fsPromises.mkdir(timeoutCache, { recursive: true });

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

async function runQueueTest() {
  const server = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      PAIROFCLEATS_HOME: queueCache,
      PAIROFCLEATS_CACHE_ROOT: queueCache,
      PAIROFCLEATS_MCP_QUEUE_MAX: '1'
    }
  });
  const { readMessage } = createReader(server.stdout);
  const timeout = setTimeout(() => {
    console.error('MCP queue test timed out.');
    server.kill('SIGKILL');
    process.exit(1);
  }, 30000);
  const send = (payload) => server.stdin.write(encodeMessage(payload));

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
      params: { name: 'index_status', arguments: { repoPath: root } }
    });
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'index_status', arguments: { repoPath: root } }
    });

    const first = await readMessage();
    const second = await readMessage();
    const responses = [first, second];
    const overload = responses.find((msg) => msg?.error?.code === -32001);
    if (!overload || overload.error?.data?.code !== 'QUEUE_OVERLOADED') {
      throw new Error('Expected queue overload error response.');
    }

    send({ jsonrpc: '2.0', id: 4, method: 'shutdown' });
    await readMessage();
    send({ jsonrpc: '2.0', method: 'exit' });
  } catch (err) {
    server.kill('SIGKILL');
    throw err;
  } finally {
    clearTimeout(timeout);
    server.stdin.end();
  }
}

async function runTimeoutTest() {
  const server = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      PAIROFCLEATS_HOME: timeoutCache,
      PAIROFCLEATS_CACHE_ROOT: timeoutCache,
      PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS: '1'
    }
  });
  const { readMessage } = createReader(server.stdout);
  const timeout = setTimeout(() => {
    console.error('MCP timeout test timed out.');
    server.kill('SIGKILL');
    process.exit(1);
  }, 30000);
  const send = (payload) => server.stdin.write(encodeMessage(payload));

  try {
    send({
      jsonrpc: '2.0',
      id: 10,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {} }
    });
    await readMessage();

    send({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'index_status', arguments: { repoPath: root } }
    });
    const response = await readMessage();
    const payloadText = response.result?.content?.[0]?.text || '';
    const payload = JSON.parse(payloadText || '{}');
    if (!response.result?.isError || payload.code !== 'TOOL_TIMEOUT') {
      throw new Error('Expected tool timeout error response.');
    }

    send({ jsonrpc: '2.0', id: 12, method: 'shutdown' });
    await readMessage();
    send({ jsonrpc: '2.0', method: 'exit' });
  } catch (err) {
    server.kill('SIGKILL');
    throw err;
  } finally {
    clearTimeout(timeout);
    server.stdin.end();
  }
}

runQueueTest()
  .then(runTimeoutTest)
  .then(() => {
    console.log('MCP robustness tests passed');
  })
  .catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });

#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const serverPath = path.join(process.cwd(), 'tools', 'mcp-server.js');
const sampleRepo = path.join(process.cwd(), 'tests', 'fixtures', 'sample');
const tempRoot = path.join(process.cwd(), 'tests', '.cache', 'mcp-server');
const cacheRoot = path.join(tempRoot, 'cache');
const emptyRepo = path.join(tempRoot, 'empty');
const missingRepo = path.join(tempRoot, 'missing');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
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

const { readMessage, notifications } = createReader(server.stdout);
const timeout = setTimeout(() => {
  console.error('MCP server test timed out.');
  server.kill('SIGKILL');
  process.exit(1);
}, 30000);

function send(payload) {
  server.stdin.write(encodeMessage(payload));
}

async function run() {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {} }
  });
  const init = await readMessage();
  if (!init.result?.serverInfo?.name) {
    throw new Error('initialize response missing serverInfo');
  }

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const list = await readMessage();
  const toolNames = (list.result?.tools || []).map((t) => t.name);
  if (!toolNames.includes('index_status')) {
    throw new Error('tools/list missing index_status');
  }
  if (!toolNames.includes('config_status')) {
    throw new Error('tools/list missing config_status');
  }

  send({
    jsonrpc: '2.0',
    id: 3,
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

  send({
    jsonrpc: '2.0',
    id: 30,
    method: 'tools/call',
    params: {
      name: 'config_status',
      arguments: { repoPath: emptyRepo }
    }
  });
  const configStatus = await readMessage();
  const configPayload = JSON.parse(configStatus.result?.content?.[0]?.text || '{}');
  const warningCodes = new Set((configPayload.warnings || []).map((w) => w.code));
  if (!warningCodes.has('dictionary_missing')) {
    throw new Error('config_status missing dictionary warning');
  }
  if (!warningCodes.has('model_missing')) {
    throw new Error('config_status missing model warning');
  }
  if (!warningCodes.has('sqlite_missing')) {
    throw new Error('config_status missing sqlite warning');
  }

  notifications.length = 0;
  send({
    jsonrpc: '2.0',
    id: 31,
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
  await readMessage();
  const progressEvents = notifications.filter(
    (msg) => msg.method === 'notifications/progress' && msg.params?.tool === 'build_index'
  );
  if (!progressEvents.length) {
    throw new Error('build_index did not emit progress notifications');
  }

  send({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'index_status',
      arguments: { repoPath: missingRepo }
    }
  });
  const invalidRepo = await readMessage();
  if (!invalidRepo.result?.isError) {
    throw new Error('index_status missing repo should return isError');
  }
  const invalidPayload = JSON.parse(invalidRepo.result?.content?.[0]?.text || '{}');
  if (!invalidPayload.message?.includes('Repo path not found')) {
    throw new Error('index_status missing repo error payload missing message');
  }

  send({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'search',
      arguments: { repoPath: emptyRepo, query: 'test' }
    }
  });
  const missingIndex = await readMessage();
  if (!missingIndex.result?.isError) {
    throw new Error('search without indexes should return isError');
  }
  const missingPayload = JSON.parse(missingIndex.result?.content?.[0]?.text || '{}');
  if (!missingPayload.message?.toLowerCase().includes('index')) {
    throw new Error('search missing index error payload missing message');
  }
  const hint = missingPayload.hint || '';
  if (!hint.includes('build-index') && !hint.includes('build-sqlite-index')) {
    throw new Error('search missing index error payload missing hint');
  }

  send({ jsonrpc: '2.0', id: 6, method: 'shutdown' });
  await readMessage();
  send({ jsonrpc: '2.0', method: 'exit' });
}

run()
  .then(() => {
    clearTimeout(timeout);
    server.stdin.end();
    console.log('MCP server tests passed');
  })
  .catch((err) => {
    clearTimeout(timeout);
    console.error(err.message);
    server.kill('SIGKILL');
    process.exit(1);
  });

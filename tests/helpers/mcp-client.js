import { spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const encodeMessage = (payload) => {
  const json = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
};

const createLineReader = (stream) => {
  let buffer = '';
  const notifications = [];
  const tryRead = () => {
    const idx = buffer.indexOf('\n');
    if (idx === -1) return null;
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) return null;
    return JSON.parse(line);
  };

  const readRaw = async () => {
    const existing = tryRead();
    if (existing) return existing;
    return new Promise((resolve) => {
      const onData = (chunk) => {
        buffer += chunk.toString('utf8');
        const parsed = tryRead();
        if (!parsed) return;
        stream.off('data', onData);
        resolve(parsed);
      };
      stream.on('data', onData);
    });
  };

  const readAnyMessage = async () => {
    const parsed = await readRaw();
    if (parsed && parsed.method && parsed.id === undefined) {
      notifications.push(parsed);
    }
    return parsed;
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

  return { readMessage, readAnyMessage, notifications };
};

const createReader = (stream) => {
  let buffer = Buffer.alloc(0);
  const notifications = [];
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

  const readAnyMessage = async () => {
    const parsed = await readRaw();
    if (parsed && parsed.method && parsed.id === undefined) {
      notifications.push(parsed);
    }
    return parsed;
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

  return { readMessage, readAnyMessage, notifications };
};

export const startMcpServer = async ({
  cacheRoot,
  mode = null,
  transport = null,
  env = {},
  args = [],
  timeoutMs = 30000
}) => {
  if (!cacheRoot) throw new Error('cacheRoot is required');
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  const serverPath = path.join(ROOT, 'tools', 'mcp', 'server.js');
  const serverArgs = [serverPath];
  if (mode) {
    serverArgs.push('--mcp-mode', mode);
  }
  if (Array.isArray(args) && args.length) {
    serverArgs.push(...args);
  }
  const server = spawn(process.execPath, serverArgs, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      PAIROFCLEATS_TESTING: '1',
      PAIROFCLEATS_HOME: cacheRoot,
      PAIROFCLEATS_CACHE_ROOT: cacheRoot,
      ...env
    }
  });

  const effectiveTransport = transport || mode || 'legacy';
  const reader = effectiveTransport === 'sdk'
    ? createLineReader(server.stdout)
    : createReader(server.stdout);
  const { readMessage, readAnyMessage, notifications } = reader;
  const resolvedTimeoutMs = Number.isFinite(Number(timeoutMs))
    ? Math.max(1000, Math.floor(Number(timeoutMs)))
    : 30000;
  const timeout = setTimeout(() => {
    console.error('MCP server test timed out.');
    server.kill('SIGKILL');
    process.exit(1);
  }, resolvedTimeoutMs);

  const send = (payload) => {
    if (effectiveTransport === 'sdk') {
      server.stdin.write(`${JSON.stringify(payload)}\n`);
      return;
    }
    server.stdin.write(encodeMessage(payload));
  };

  const shutdown = async () => {
    clearTimeout(timeout);
    server.stdin.end();
    server.kill('SIGTERM');
  };

  return { server, send, readMessage, readAnyMessage, notifications, shutdown };
};

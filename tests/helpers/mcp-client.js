import { spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const encodeFramedMessage = (payload) => {
  const json = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
};

const createReader = (stream, { onActivity } = {}) => {
  let buffer = Buffer.alloc(0);
  const notifications = [];
  const MAX_GARBAGE_BYTES = 1024 * 1024;
  const trimLeadingWhitespace = () => {
    let offset = 0;
    while (offset < buffer.length) {
      const byte = buffer[offset];
      if (byte === 0x20 || byte === 0x09 || byte === 0x0d || byte === 0x0a) {
        offset += 1;
        continue;
      }
      break;
    }
    if (offset > 0) {
      buffer = buffer.slice(offset);
    }
  };
  const tryRead = () => {
    while (true) {
      trimLeadingWhitespace();
      if (!buffer.length) return null;

      let headerEnd = buffer.indexOf('\r\n\r\n');
      let headerBytes = 4;
      if (headerEnd === -1) {
        headerEnd = buffer.indexOf('\n\n');
        headerBytes = 2;
      }
      if (headerEnd >= 0) {
        const header = buffer.slice(0, headerEnd).toString('utf8');
        const match = header.match(/(?:^|\r?\n)\s*content-length\s*:\s*(\d+)\s*(?:\r?\n|$)/i);
        if (match) {
          const length = parseInt(match[1], 10);
          const total = headerEnd + headerBytes + length;
          if (buffer.length < total) return null;
          const body = buffer.slice(headerEnd + headerBytes, total).toString('utf8');
          buffer = buffer.slice(total);
          return JSON.parse(body);
        }
      }

      const newlineIndex = buffer.indexOf('\n');
      const shouldParseLine = newlineIndex !== -1 && (headerEnd === -1 || newlineIndex < headerEnd);
      if (shouldParseLine) {
        const line = buffer.slice(0, newlineIndex + 1).toString('utf8').trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        try {
          return JSON.parse(line);
        } catch {
          continue;
        }
      }

      if (headerEnd >= 0) {
        // Keep waiting for either a newline-delimited message or a framed header.
        if (headerEnd > MAX_GARBAGE_BYTES) {
          buffer = buffer.slice(headerEnd);
        }
        return null;
      }

      if (buffer.length > MAX_GARBAGE_BYTES) {
        // Prevent unbounded growth if non-protocol stdout is emitted.
        buffer = buffer.slice(-4096);
      }
      return null;
    }
  };

  const readRaw = async () => {
    const existing = tryRead();
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        stream.off('data', onData);
        stream.off('end', onEnd);
        stream.off('close', onEnd);
        stream.off('error', onError);
      };
      const onData = (chunk) => {
        onActivity?.();
        buffer = Buffer.concat([buffer, chunk]);
        const parsed = tryRead();
        if (!parsed) return;
        if (settled) return;
        settled = true;
        cleanup();
        onActivity?.();
        resolve(parsed);
      };
      const onEnd = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('MCP server stream closed before a complete message was received.'));
      };
      const onError = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };
      stream.on('data', onData);
      stream.on('end', onEnd);
      stream.on('close', onEnd);
      stream.on('error', onError);
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
  timeoutMs = 120000
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

  let timeout = null;
  const resolvedTimeoutMs = Number.isFinite(Number(timeoutMs))
    ? Math.max(1000, Math.floor(Number(timeoutMs)))
    : 120000;
  const touchTimeout = () => {
    if (!resolvedTimeoutMs) return;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      console.error(`MCP server test timed out after ${resolvedTimeoutMs}ms.`);
      server.kill('SIGKILL');
    }, resolvedTimeoutMs);
  };
  const reader = createReader(server.stdout, { onActivity: touchTimeout });
  const { readMessage, readAnyMessage, notifications } = reader;
  touchTimeout();
  const resolvedTransport = transport || (mode === 'sdk' ? 'sdk' : 'legacy');
  const send = (payload) => {
    if (resolvedTransport === 'line') {
      server.stdin.write(`${JSON.stringify(payload)}\n`);
      return;
    }
    server.stdin.write(encodeFramedMessage(payload));
  };

  const shutdown = async () => {
    if (timeout) clearTimeout(timeout);
    server.stdin.end();
    server.kill('SIGTERM');
  };

  return { server, send, readMessage, readAnyMessage, notifications, shutdown };
};

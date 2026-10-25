import { spawn } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureTestingEnv } from './test-env.js';
import { createMcpTestReader } from './mcp-reader.js';
import { registerChildProcessForCleanup, terminateTrackedSubprocesses } from '../../src/shared/subprocess/tracking.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const encodeFramedMessage = (payload) => {
  const json = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
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
  const resolvedTransport = transport || (mode === 'sdk' ? 'line' : 'legacy');
  if (!['legacy', 'line', 'sdk'].includes(resolvedTransport)) throw new TypeError('Unsupported MCP test transport.');
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  const serverPath = path.join(ROOT, 'tools', 'mcp', 'server.js');
  const serverArgs = [serverPath];
  if (mode) {
    serverArgs.push('--mcp-mode', mode);
  }
  if (Array.isArray(args) && args.length) {
    serverArgs.push(...args);
  }
  const childEnv = ensureTestingEnv({
    ...process.env,
    PAIROFCLEATS_HOME: cacheRoot,
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    ...env
  });
  const server = spawn(process.execPath, serverArgs, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: childEnv
  });
  const ownershipId = `tests:mcp:${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
  const unregisterTrackedServer = registerChildProcessForCleanup(server, {
    killTree: true,
    detached: false,
    command: process.execPath,
    args: serverArgs,
    name: 'tests-mcp-server',
    ownershipId,
    scope: ownershipId
  });

  let timeout = null;
  const resolvedTimeoutMs = Number.isFinite(Number(timeoutMs))
    ? Math.max(1000, Math.floor(Number(timeoutMs)))
    : 120000;
  const touchTimeout = () => {
    if (!resolvedTimeoutMs) return;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      const timeoutError = new Error(`MCP server test timed out after ${resolvedTimeoutMs}ms.`);
      console.error(timeoutError.message);
      cancelPending(timeoutError);
      void terminateTrackedSubprocesses({
        reason: 'mcp_server_test_timeout',
        ownershipId,
        force: true
      });
    }, resolvedTimeoutMs);
  };
  const reader = createMcpTestReader(server.stdout, { transport: resolvedTransport, onActivity: touchTimeout });
  const { readMessage, readAnyMessage, notifications, cancelPending } = reader;
  touchTimeout();
  const send = (payload) => {
    if (resolvedTransport === 'line' || resolvedTransport === 'sdk') {
      server.stdin.write(`${JSON.stringify(payload)}\n`);
      return;
    }
    server.stdin.write(encodeFramedMessage(payload));
  };

  const shutdown = async () => {
    if (timeout) clearTimeout(timeout);
    cancelPending(new Error('MCP server test shutdown.'));
    try {
      server.stdin.end();
    } catch {}
    try {
      let result = await terminateTrackedSubprocesses({
        reason: 'mcp_server_test_shutdown',
        ownershipId,
        force: false
      });
      if (Number(result?.failures || 0) > 0) {
        result = await terminateTrackedSubprocesses({
          reason: 'mcp_server_test_shutdown_force',
          ownershipId,
          force: true
        });
      }
    } finally {
      unregisterTrackedServer();
    }
  };

  return { server, send, readMessage, readAnyMessage, notifications, shutdown };
};



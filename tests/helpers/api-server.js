import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attachSilentLogging } from './test-env.js';
import { terminateChild } from './process-lifecycle.js';
import { registerChildProcessForCleanup } from '../../src/shared/subprocess.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Launch the API server test harness and expose request helpers.
 *
 * `requestJson` parses JSON responses and returns `body` as an object.
 * `requestRaw` always returns raw `body` text and best-effort parsed `json`
 * when the response advertises `application/json`.
 *
 * @returns {Promise<{
 *   server: import('node:child_process').ChildProcessWithoutNullStreams,
 *   serverInfo: Record<string, unknown>,
 *   requestJson: (
 *     method: string,
 *     requestPath: string,
 *     body: unknown,
 *     serverInfo: {host?: string, port?: number},
 *     options?: {headers?: Record<string, string>, auth?: boolean}
 *   ) => Promise<{status: number, body: Record<string, unknown>, headers: import('node:http').IncomingHttpHeaders}>,
 *   requestRaw: (
 *     method: string,
 *     requestPath: string,
 *     body: unknown,
 *     serverInfo: {host?: string, port?: number},
 *     options?: {headers?: Record<string, string>, auth?: boolean}
 *   ) => Promise<{status: number, body: string, json: Record<string, unknown>|null, headers: import('node:http').IncomingHttpHeaders}>,
 *   stop: () => Promise<void>
 * }>}
 */
export const startApiServer = async ({
  repoRoot,
  allowedRoots = [],
  env,
  authToken = 'test-token',
  maxBodyBytes = null,
  allowUnauthenticated = false,
  corsAllowedOrigins = [],
  corsAllowAny = false,
  startupTimeoutMs = null
}) => {
  const serverPath = path.join(ROOT, 'tools', 'api', 'server.js');
  const args = [
    serverPath,
    '--port',
    '0',
    '--json',
    '--quiet',
    '--repo',
    repoRoot
  ];
  if (authToken) {
    args.push('--auth-token', authToken);
  } else if (allowUnauthenticated) {
    args.push('--allow-unauthenticated');
  }
  if (allowedRoots.length) {
    args.push('--allowed-repo-roots', ...allowedRoots);
  }
  if (Number.isFinite(Number(maxBodyBytes))) {
    args.push('--max-body-bytes', String(Math.floor(Number(maxBodyBytes))));
  }
  if (Array.isArray(corsAllowedOrigins) && corsAllowedOrigins.length) {
    args.push('--cors-allowed-origins', corsAllowedOrigins.join(','));
  }
  if (corsAllowAny === true) {
    args.push('--cors-allow-any');
  }

  const server = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const unregisterTrackedServer = registerChildProcessForCleanup(server, {
    killTree: true,
    detached: process.platform !== 'win32',
    name: 'api-server-test',
    command: process.execPath,
    args
  });
  attachSilentLogging(server, 'api-server');

  const resolvedStartupTimeoutMs = startupTimeoutMs !== null
    && startupTimeoutMs !== undefined
    && Number.isFinite(Number(startupTimeoutMs))
    ? Math.max(1000, Math.floor(Number(startupTimeoutMs)))
    : Number.isFinite(Number(process.env.PAIROFCLEATS_TEST_API_STARTUP_TIMEOUT_MS))
      ? Math.max(1000, Math.floor(Number(process.env.PAIROFCLEATS_TEST_API_STARTUP_TIMEOUT_MS)))
      : 30000;

  const readStartup = async () => {
    return await new Promise((resolve, reject) => {
      let settled = false;
      let stdoutBuffer = '';
      let stdoutTail = '';
      let stderrTail = '';
      const maxTailChars = 4096;
      const appendTail = (current, next) => {
        const combined = `${current}${next}`;
        if (combined.length <= maxTailChars) return combined;
        return combined.slice(-maxTailChars);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        server.off('exit', handleExitBeforeStartup);
        server.off('error', handleStartupError);
        server.stdout?.off('data', handleStdoutData);
        server.stderr?.off('data', handleStderrData);
      };
      const fail = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };
      const succeed = (line) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(line);
      };
      const handleExitBeforeStartup = (code, signal) => {
        const details = [
          `api-server exited before startup (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
        ];
        const stderrText = stderrTail.trim();
        const stdoutText = stdoutTail.trim();
        if (stderrText) details.push(`stderr tail:\n${stderrText}`);
        if (stdoutText) details.push(`stdout tail:\n${stdoutText}`);
        fail(new Error(details.join('\n\n')));
      };
      const handleStartupError = (err) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      };
      const handleStdoutData = (chunk) => {
        if (settled) return;
        const text = chunk.toString();
        if (!text) return;
        stdoutTail = appendTail(stdoutTail, text);
        stdoutBuffer += text;
        while (true) {
          const newline = stdoutBuffer.indexOf('\n');
          if (newline === -1) break;
          const lineRaw = stdoutBuffer.slice(0, newline);
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          const line = lineRaw.trim();
          if (!line) continue;
          succeed(line);
          return;
        }
      };
      const handleStderrData = (chunk) => {
        if (settled) return;
        const text = chunk.toString();
        if (!text) return;
        stderrTail = appendTail(stderrTail, text);
      };
      const timeout = setTimeout(() => {
        const details = [`api-server startup timed out after ${resolvedStartupTimeoutMs}ms`];
        const stderrText = stderrTail.trim();
        const stdoutText = stdoutTail.trim();
        if (stderrText) details.push(`stderr tail:\n${stderrText}`);
        if (stdoutText) details.push(`stdout tail:\n${stdoutText}`);
        fail(new Error(details.join('\n\n')));
      }, resolvedStartupTimeoutMs);
      server.stdout?.on('data', handleStdoutData);
      server.stderr?.on('data', handleStderrData);
      server.once('exit', handleExitBeforeStartup);
      server.once('error', handleStartupError);
    });
  };

  const requestJson = async (method, requestPath, body, serverInfo, options = {}) => await new Promise((resolve, reject) => {
    const host = serverInfo?.host || '127.0.0.1';
    const port = serverInfo?.port || 0;
    const payload = body ? JSON.stringify(body) : null;
    const headers = { ...(options.headers || {}) };
    if (options.auth !== false && authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    if (payload) {
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(
      {
        host,
        port,
        path: requestPath,
        method,
        headers
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode || 0,
              body: JSON.parse(data || '{}'),
              headers: res.headers || {}
            });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

  const requestRaw = async (method, requestPath, body, serverInfo, options = {}) => await new Promise((resolve, reject) => {
    const host = serverInfo?.host || '127.0.0.1';
    const port = serverInfo?.port || 0;
    const payload = body ? String(body) : '';
    const headers = { ...(options.headers || {}) };
    if (options.auth !== false && authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(
      {
        host,
        port,
        path: requestPath,
        method,
        headers
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          const contentType = String(res.headers?.['content-type'] || '').toLowerCase();
          let json = null;
          if (contentType.includes('application/json')) {
            try {
              json = JSON.parse(data || '{}');
            } catch {
              json = null;
            }
          }
          resolve({
            status: res.statusCode || 0,
            body: data,
            json,
            headers: res.headers || {}
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

  let serverInfo = null;
  try {
    const line = await readStartup();
    serverInfo = JSON.parse(line || '{}');
    if (!serverInfo?.port) {
      throw new Error('api-server did not report a listening port');
    }
  } catch (error) {
    await terminateChild(server, { graceMs: 5000 });
    unregisterTrackedServer();
    throw error;
  }

  const stop = async () => {
    try {
      await terminateChild(server, { graceMs: 5000 });
    } finally {
      unregisterTrackedServer();
    }
  };

  return { server, serverInfo, requestJson, requestRaw, stop };
};

import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attachSilentLogging } from './test-env.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
  attachSilentLogging(server, 'api-server');

  const resolvedStartupTimeoutMs = startupTimeoutMs !== null
    && startupTimeoutMs !== undefined
    && Number.isFinite(Number(startupTimeoutMs))
    ? Math.max(1000, Math.floor(Number(startupTimeoutMs)))
    : Number.isFinite(Number(process.env.PAIROFCLEATS_TEST_API_STARTUP_TIMEOUT_MS))
      ? Math.max(1000, Math.floor(Number(process.env.PAIROFCLEATS_TEST_API_STARTUP_TIMEOUT_MS)))
      : 30000;

  const readStartup = async () => {
    const rl = readline.createInterface({ input: server.stdout });
    return await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        server.off('exit', handleExitBeforeStartup);
        server.off('error', handleStartupError);
        try {
          rl.close();
        } catch {
          // ignore close race; readline may already be closed
        }
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
        fail(new Error(`api-server exited before startup (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
      };
      const handleStartupError = (err) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      };
      const timeout = setTimeout(() => {
        fail(new Error(`api-server startup timed out after ${resolvedStartupTimeoutMs}ms`));
      }, resolvedStartupTimeoutMs);
      rl.once('line', succeed);
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

  const line = await readStartup();
  const serverInfo = JSON.parse(line || '{}');
  if (!serverInfo?.port) {
    throw new Error('api-server did not report a listening port');
  }

  const stop = async () => await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      server.kill('SIGKILL');
      resolve();
    }, 5000);
    server.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    server.kill('SIGTERM');
  });

  return { server, serverInfo, requestJson, requestRaw, stop };
};

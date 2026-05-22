import http from 'node:http';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyTestEnv, attachSilentLogging } from './test-env.js';
import { terminateChild } from './process-lifecycle.js';
import { registerChildProcessForCleanup } from '../../src/shared/subprocess/tracking.js';
import { ensureFixtureIndex } from './fixture-index.js';
import { normalizeTestCacheScope, resolveTestCachePath } from './test-cache.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const API_FIXTURE_TEST_CONFIG = {
  sqlite: {
    use: false
  },
  indexing: {
    typeInference: false,
    typeInferenceCrossFile: false,
    riskAnalysis: false,
    riskAnalysisCrossFile: false,
    embeddings: {
      enabled: false,
      mode: 'off',
      lancedb: { enabled: false },
      hnsw: { enabled: false }
    }
  },
  tooling: {
    lsp: {
      enabled: false
    }
  }
};

const truncateCacheName = (value) => {
  const maxLength = 64;
  const text = String(value || '').trim();
  if (!text) return 'fixture-cache';
  if (text.length <= maxLength) return text;
  const digest = crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);
  const headLength = Math.max(8, maxLength - digest.length - 1);
  return `${text.slice(0, headLength)}-${digest}`;
};

const resolveCohortCacheName = (cacheName, { cacheScope }) => {
  const suffixRaw = cacheScope === 'shared'
    ? ''
    : (typeof process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX === 'string'
      ? process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX.trim()
      : '');
  if (!suffixRaw) return truncateCacheName(cacheName);
  if (cacheName.endsWith(`-${suffixRaw}`)) return truncateCacheName(cacheName);
  return truncateCacheName(`${cacheName}-${suffixRaw}`);
};

const resolveFixtureRoot = async (fixtureName) => {
  const fixtureRootRaw = path.join(ROOT, 'tests', 'fixtures', fixtureName);
  try {
    return await fsPromises.realpath(fixtureRootRaw);
  } catch {
    return path.resolve(fixtureRootRaw);
  }
};

const createApiFixtureEnv = (cacheRoot, envOverrides = {}, { syncProcess = true } = {}) => {
  const { PAIROFCLEATS_TEST_CONFIG: testConfigOverride, ...restOverrides } = envOverrides;
  return applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: testConfigOverride || API_FIXTURE_TEST_CONFIG,
    extraEnv: {
      PAIROFCLEATS_WORKER_POOL: 'off',
      ...restOverrides
    },
    syncProcess
  });
};

export const parseSseEvent = (block) => {
  const lines = String(block || '').replace(/\r\n/g, '\n').split('\n');
  let event = 'message';
  const dataLines = [];
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  const dataText = dataLines.join('\n');
  const data = dataText ? JSON.parse(dataText) : null;
  return { event, data };
};

export const parseSseEvents = (text) => {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const events = [];
  for (const block of normalized.split(/\n\n+/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    events.push(parseSseEvent(trimmed));
  }
  return events;
};

/**
 * Launch the API server test harness and expose request helpers.
 *
 * `requestJson` parses JSON responses and returns `body` as an object.
 * `requestRaw` always returns raw `body` text and best-effort parsed `json`
 * when the response advertises `application/json`.
 * `requestSse` parses server-sent events and can stop once a named event arrives.
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
 *   requestSse: (
 *     method: string,
 *     requestPath: string,
 *     body: unknown,
 *     serverInfo: {host?: string, port?: number},
 *     options?: {headers?: Record<string, string>, auth?: boolean, stopOnEvent?: string|null, abortAfterFirstChunk?: boolean, abortTimeoutMs?: number}
 *   ) => Promise<{status: number, events: Array<{event: string, data: unknown}>, headers: import('node:http').IncomingHttpHeaders, aborted: boolean, timedOut: boolean}>,
 *   stop: () => Promise<void>
 * }>}
 */
export const startApiServer = async ({
  repoRoot,
  allowedRoots = [],
  env,
  host = '127.0.0.1',
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
    '--host',
    host,
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
    detached: false,
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

  const requestSse = async (method, requestPath, body, serverInfo, options = {}) => await new Promise((resolve, reject) => {
    const host = serverInfo?.host || '127.0.0.1';
    const port = serverInfo?.port || 0;
    const payload = body ? JSON.stringify(body) : null;
    const headers = { ...(options.headers || {}) };
    if (!headers.Accept) {
      headers.Accept = 'text/event-stream';
    }
    if (options.auth !== false && authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    if (payload) {
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const events = [];
    let buffer = '';
    let settled = false;
    let abortTimer = null;
    let responseStatus = 0;
    let responseHeaders = {};
    const stopOnEvent = options.stopOnEvent === undefined ? null : options.stopOnEvent;
    const abortAfterFirstChunk = options.abortAfterFirstChunk === true;
    const abortTimeoutMs = Number.isFinite(Number(options.abortTimeoutMs))
      ? Math.max(1, Math.floor(Number(options.abortTimeoutMs)))
      : null;
    const clearAbortTimer = () => {
      if (abortTimer) {
        clearTimeout(abortTimer);
        abortTimer = null;
      }
    };
    const finish = (extra = {}, { destroy = false } = {}) => {
      if (settled) return;
      settled = true;
      clearAbortTimer();
      if (destroy) req.destroy();
      resolve({
        status: responseStatus,
        events,
        headers: responseHeaders,
        aborted: false,
        timedOut: false,
        ...extra
      });
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearAbortTimer();
      reject(err);
    };
    const drainEvents = () => {
      while (true) {
        const idx = buffer.indexOf('\n\n');
        if (idx === -1) break;
        const block = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);
        if (!block) continue;
        const parsed = parseSseEvent(block);
        events.push(parsed);
        if (stopOnEvent && parsed.event === stopOnEvent) {
          finish({}, { destroy: true });
          return false;
        }
      }
      return true;
    };

    const req = http.request(
      {
        host,
        port,
        path: requestPath,
        method,
        headers
      },
      (res) => {
        responseStatus = res.statusCode || 0;
        responseHeaders = res.headers || {};
        if (abortAfterFirstChunk && abortTimeoutMs !== null) {
          abortTimer = setTimeout(() => {
            finish({ aborted: true, timedOut: true }, { destroy: true });
          }, abortTimeoutMs);
        }
        res.on('data', (chunk) => {
          if (settled) return;
          const text = chunk.toString().replace(/\r\n/g, '\n');
          try {
            if (abortAfterFirstChunk) {
              buffer += text;
              drainEvents();
              finish({ aborted: true }, { destroy: true });
              return;
            }
            buffer += text;
            drainEvents();
          } catch (err) {
            fail(err);
          }
        });
        res.on('end', () => {
          if (settled) return;
          try {
            if (buffer.trim()) {
              events.push(parseSseEvent(buffer.trim()));
              buffer = '';
            }
            finish();
          } catch (err) {
            fail(err);
          }
        });
        res.on('error', (err) => {
          if (settled && err?.code === 'ECONNRESET') return;
          fail(err);
        });
      }
    );
    req.on('error', (err) => {
      if (settled && err?.code === 'ECONNRESET') return;
      fail(err);
    });
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

  return { server, serverInfo, requestJson, requestRaw, requestSse, stop };
};

export const prepareFixtureApiServerCohort = async ({
  fixtureName = 'sample',
  cacheName,
  cacheScope = 'shared',
  resetCache = true,
  envOverrides = {},
  fixtureOptions = {},
  serverDefaults = {},
  indexFixture = true
} = {}) => {
  if (!cacheName || !String(cacheName).trim()) {
    throw new Error('prepareFixtureApiServerCohort requires cacheName');
  }
  const normalizedCacheScope = normalizeTestCacheScope(cacheScope, { defaultScope: 'shared' });
  if (resetCache && normalizedCacheScope !== 'shared') {
    throw new Error('prepareFixtureApiServerCohort only supports resetCache for shared cacheScope');
  }
  const normalizedCacheName = String(cacheName).trim();
  if (resetCache) {
    await fsPromises.rm(resolveTestCachePath(ROOT, normalizedCacheName), {
      recursive: true,
      force: true
    });
  }
  const fixture = indexFixture
    ? await ensureFixtureIndex({
      fixtureName,
      cacheName: normalizedCacheName,
      cacheScope: normalizedCacheScope,
      envOverrides,
      ...fixtureOptions
    })
    : await (async () => {
      const cacheRoot = resolveTestCachePath(
        ROOT,
        resolveCohortCacheName(normalizedCacheName, { cacheScope: normalizedCacheScope })
      );
      await fsPromises.mkdir(cacheRoot, { recursive: true });
      return {
        root: ROOT,
        fixtureRoot: await resolveFixtureRoot(fixtureName),
        cacheRoot,
        env: createApiFixtureEnv(cacheRoot, envOverrides, { syncProcess: false }),
        userConfig: null,
        codeDir: null,
        proseDir: null
      };
    })();
  const cohort = {
    kind: 'fixture-api-server',
    fixtureName,
    cacheName: normalizedCacheName,
    cacheScope: normalizedCacheScope,
    resetCache: Boolean(resetCache)
  };
  const start = async ({
    envOverrides: runtimeEnvOverrides = {},
    ...serverOptions
  } = {}) => {
    if (!indexFixture) {
      throw new Error('prepareFixtureApiServerCohort start requires indexFixture');
    }
    return await startApiServer({
      repoRoot: fixture.fixtureRoot,
      env: {
        ...fixture.env,
        ...runtimeEnvOverrides
      },
      ...serverDefaults,
      ...serverOptions
    });
  };

  return {
    ...fixture,
    cohort,
    start
  };
};

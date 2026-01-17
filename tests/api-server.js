#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import fsPromises from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = path.join(root, 'tests', '.cache', 'api-server');
const emptyRepo = path.join(cacheRoot, 'empty');
const serverPath = path.join(root, 'tools', 'api-server.js');
const authToken = 'test-token';

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(emptyRepo, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const build = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', fixtureRoot],
  { env, stdio: 'inherit' }
);
if (build.status !== 0) {
  console.error('api-server test failed: build_index failed');
  process.exit(build.status ?? 1);
}

const server = spawn(
  process.execPath,
  [
    serverPath,
    '--port',
    '0',
    '--json',
    '--quiet',
    '--repo',
    fixtureRoot,
    '--auth-token',
    authToken,
    '--allowed-repo-roots',
    emptyRepo,
    '--max-body-bytes',
    '512'
  ],
  { env, stdio: ['ignore', 'pipe', 'pipe'] }
);

let stderr = '';
server.stderr?.on('data', (chunk) => {
  stderr += chunk.toString();
});

const readStartup = async () => {
  const rl = readline.createInterface({ input: server.stdout });
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      rl.close();
      reject(new Error('api-server startup timed out'));
    }, 10000);
    rl.once('line', (line) => {
      clearTimeout(timeout);
      rl.close();
      resolve(line);
    });
  });
};

const requestJson = async (method, requestPath, body, options = {}) => await new Promise((resolve, reject) => {
  const host = serverInfo?.host || '127.0.0.1';
  const port = serverInfo?.port || 0;
  const payload = body ? JSON.stringify(body) : null;
  const headers = { ...(options.headers || {}) };
  if (options.auth !== false) {
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
          resolve({ status: res.statusCode || 0, body: JSON.parse(data || '{}') });
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

const requestRaw = async (method, requestPath, body, options = {}) => await new Promise((resolve, reject) => {
  const host = serverInfo?.host || '127.0.0.1';
  const port = serverInfo?.port || 0;
  const payload = body ? String(body) : '';
  const headers = { ...(options.headers || {}) };
  if (options.auth !== false) {
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
        try {
          resolve({ status: res.statusCode || 0, body: JSON.parse(data || '{}') });
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

let serverInfo = null;
try {
  const line = await readStartup();
  serverInfo = JSON.parse(line || '{}');
  if (!serverInfo?.port) {
    throw new Error('api-server did not report a listening port');
  }

  const unauthorized = await requestJson('GET', '/health', null, { auth: false });
  if (unauthorized.status !== 401 || unauthorized.body?.code !== 'UNAUTHORIZED') {
    throw new Error('api-server should reject missing auth');
  }

  const corsBlocked = await requestJson('GET', '/health', null, {
    headers: { Origin: 'https://example.com' }
  });
  if (corsBlocked.status !== 403 || corsBlocked.body?.code !== 'FORBIDDEN') {
    throw new Error('api-server should reject disallowed CORS origins');
  }

  const health = await requestJson('GET', '/health');
  if (!health.body?.ok || typeof health.body.uptimeMs !== 'number') {
    throw new Error('api-server /health response invalid');
  }

  const status = await requestJson('GET', '/status');
  if (!status.body?.ok || !status.body.status?.repo?.root) {
    throw new Error('api-server /status response missing repo info');
  }

  const search = await requestJson('POST', '/search', { query: 'return', mode: 'code', top: 3 });
  const hits = search.body?.result?.code || [];
  if (!search.body?.ok || !hits.length) {
    throw new Error('api-server /search returned no results');
  }
  if (hits[0]?.tokens !== undefined) {
    throw new Error('api-server /search should default to compact JSON output');
  }

  const invalid = await requestJson('POST', '/search', {});
  if (invalid.status !== 400 || invalid.body?.ok !== false || invalid.body?.code !== 'INVALID_REQUEST') {
    throw new Error('api-server should reject missing query');
  }

  const missingContentType = await requestRaw('POST', '/search', JSON.stringify({ query: 'return' }), {
    headers: {}
  });
  if (missingContentType.status !== 415 || missingContentType.body?.code !== 'INVALID_REQUEST') {
    throw new Error('api-server should reject missing content-type');
  }

  const oversizedPayload = { query: 'return', extra: 'x'.repeat(600) };
  const tooLarge = await requestRaw('POST', '/search', JSON.stringify(oversizedPayload), {
    headers: { 'Content-Type': 'application/json' }
  });
  if (tooLarge.status !== 413 || tooLarge.body?.code !== 'INVALID_REQUEST') {
    throw new Error('api-server should enforce body size limits');
  }

  const unknownField = await requestJson('POST', '/search', {
    query: 'return',
    extraField: true
  });
  if (unknownField.status !== 400 || unknownField.body?.code !== 'INVALID_REQUEST') {
    throw new Error('api-server should reject unknown fields');
  }

  const forbidden = await requestJson('POST', '/search', {
    repoPath: cacheRoot,
    query: 'return'
  });
  if (forbidden.status !== 403 || forbidden.body?.code !== 'FORBIDDEN') {
    throw new Error('api-server should reject disallowed repo paths');
  }

  const noIndex = await requestJson('POST', '/search', {
    repoPath: emptyRepo,
    query: 'return'
  });
  if (noIndex.status !== 409 || noIndex.body?.code !== 'NO_INDEX') {
    throw new Error('api-server should return NO_INDEX when indexes are missing');
  }
} catch (err) {
  console.error(err?.message || err);
  if (stderr.trim()) {
    console.error(stderr.trim());
  }
  server.kill('SIGKILL');
  process.exit(1);
}

await new Promise((resolve) => {
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

console.log('api-server tests passed');

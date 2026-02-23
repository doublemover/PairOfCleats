#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import fsPromises from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { attachSilentLogging } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = resolveTestCachePath(root, 'api-server-stream');
const serverPath = path.join(root, 'tools', 'api', 'server.js');
const authToken = 'test-token';

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

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
  console.error('api-server stream test failed: build_index failed');
  process.exit(build.status ?? 1);
}

const server = spawn(
  process.execPath,
  [serverPath, '--port', '0', '--json', '--quiet', '--repo', fixtureRoot, '--auth-token', authToken],
  { env, stdio: ['ignore', 'pipe', 'pipe'] }
);
attachSilentLogging(server, 'api-server');
const startupTimeoutMs = Number.isFinite(Number(process.env.PAIROFCLEATS_TEST_API_STARTUP_TIMEOUT_MS))
  ? Math.max(1000, Math.floor(Number(process.env.PAIROFCLEATS_TEST_API_STARTUP_TIMEOUT_MS)))
  : 30000;

let stderr = '';
server.stderr?.on('data', (chunk) => {
  stderr += chunk.toString();
});

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
      fail(new Error(`api-server startup timed out after ${startupTimeoutMs}ms`));
    }, startupTimeoutMs);
    rl.once('line', succeed);
    server.once('exit', handleExitBeforeStartup);
    server.once('error', handleStartupError);
  });
};

const parseSse = (block) => {
  const lines = block.split(/\r?\n/);
  let event = 'message';
  let data = '';
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.replace('event:', '').trim();
      continue;
    }
    if (line.startsWith('data:')) {
      data += line.replace('data:', '').trim();
    }
  }
  const payload = data ? JSON.parse(data) : null;
  return { event, data: payload };
};

const readSse = async (method, requestPath, body) => await new Promise((resolve, reject) => {
  const payload = body ? JSON.stringify(body) : null;
  const headers = { Authorization: `Bearer ${authToken}` };
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  const events = [];
  let buffer = '';
  const req = http.request(
    {
      host: serverInfo.host,
      port: serverInfo.port,
      path: requestPath,
      method,
      headers
    },
    (res) => {
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        while (true) {
          const idx = buffer.indexOf('\n\n');
          if (idx === -1) break;
          const block = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!block) continue;
          const parsed = parseSse(block);
          events.push(parsed);
          if (parsed.event === 'done') {
            resolve(events);
            req.destroy();
            break;
          }
        }
      });
      res.on('end', () => resolve(events));
    }
  );
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

const abortStream = async (method, requestPath, body) => await new Promise((resolve, reject) => {
  const payload = body ? JSON.stringify(body) : null;
  const headers = { Authorization: `Bearer ${authToken}` };
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  const req = http.request(
    {
      host: serverInfo.host,
      port: serverInfo.port,
      path: requestPath,
      method,
      headers
    },
    (res) => {
      const timeout = setTimeout(() => {
        req.destroy();
        resolve();
      }, 1000);
      res.once('data', () => {
        clearTimeout(timeout);
        req.destroy();
        resolve();
      });
      res.on('error', (err) => {
        clearTimeout(timeout);
        if (err?.code === 'ECONNRESET') return resolve();
        reject(err);
      });
    }
  );
  req.on('error', (err) => {
    if (err?.code === 'ECONNRESET') return resolve();
    reject(err);
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

  const statusEvents = await readSse('GET', '/status/stream');
  const statusResult = statusEvents.find((evt) => evt.event === 'result');
  if (!statusResult?.data?.status?.repo?.root) {
    throw new Error('status stream missing repo payload');
  }
  const statusBody = JSON.stringify(statusResult.data || {});
  if (statusBody.includes(fixtureRoot) || statusBody.includes(cacheRoot)) {
    throw new Error('status stream leaked absolute paths');
  }

  const searchEvents = await readSse('POST', '/search/stream', { query: 'return', mode: 'code' });
  const searchResult = searchEvents.find((evt) => evt.event === 'result');
  const hits = searchResult?.data?.result?.code || [];
  if (!hits.length) {
    throw new Error('search stream returned no results');
  }

  await abortStream('POST', '/search/stream', { query: 'return', mode: 'code' });
  const followUp = await readSse('GET', '/status/stream');
  const followResult = followUp.find((evt) => evt.event === 'result');
  if (!followResult?.data?.status?.repo?.root) {
    throw new Error('stream abort should not break subsequent requests');
  }
  const followBody = JSON.stringify(followResult.data || {});
  if (followBody.includes(fixtureRoot) || followBody.includes(cacheRoot)) {
    throw new Error('follow-up status stream leaked absolute paths');
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

console.log('api-server stream tests passed');


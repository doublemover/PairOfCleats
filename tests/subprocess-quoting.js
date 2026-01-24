#!/usr/bin/env node
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import fsPromises from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = path.join(root, 'tests', '.cache', 'subprocess-quoting');
const serverPath = path.join(root, 'tools', 'api-server.js');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

// Create a repo path containing spaces to catch quoting/arg-parsing bugs.
const repoParent = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats repo with spaces '));
const repoPath = path.join(repoParent, 'sample repo');
await fsPromises.cp(fixtureRoot, repoPath, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const build = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoPath],
  { env, stdio: 'inherit' }
);
if (build.status !== 0) {
  console.error('subprocess-quoting test failed: build_index failed');
  process.exit(1);
}

const server = spawn(
  process.execPath,
  [serverPath, '--repo', repoPath, '--host', '127.0.0.1', '--port', '0', '--json'],
  { env, stdio: ['ignore', 'pipe', 'pipe'] }
);

let stderr = '';
server.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

const rl = readline.createInterface({ input: server.stdout });
const readStartup = () => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('timeout waiting for api-server startup')), 15000);
  rl.once('line', (line) => {
    clearTimeout(timeout);
    resolve(line);
  });
});

const requestJson = (baseUrl, method, pathname, body = null) => new Promise((resolve, reject) => {
  const payload = body ? JSON.stringify(body) : null;
  const req = http.request(baseUrl + pathname, {
    method,
    headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
  }, (res) => {
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
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

let serverInfo = null;
try {
  const line = await readStartup();
  serverInfo = JSON.parse(line || '{}');
  if (!serverInfo?.baseUrl) {
    throw new Error('api-server did not report a baseUrl');
  }

  const health = await requestJson(serverInfo.baseUrl, 'GET', '/health');
  if (!health.body?.ok) {
    throw new Error('api-server /health failed');
  }

  const status = await requestJson(serverInfo.baseUrl, 'GET', '/status');
  if (!status.body?.ok || !status.body?.status) {
    throw new Error('api-server /status failed');
  }

  const search = await requestJson(serverInfo.baseUrl, 'POST', '/search', {
    repoPath,
    query: 'greet',
    mode: 'code',
    top: 3
  });
  if (!search.body?.ok || !Array.isArray(search.body?.result?.code) || !search.body.result.code.length) {
    throw new Error('api-server /search returned no results');
  }
} catch (err) {
  console.error(err?.message || err);
  if (stderr.trim()) {
    console.error(stderr.trim());
  }
  server.kill('SIGKILL');
  process.exit(1);
} finally {
  try {
    server.kill('SIGKILL');
  } catch (e) {
    // ignore
  }
}

console.log('subprocess-quoting: ok');

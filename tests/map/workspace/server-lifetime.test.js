import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createArtifactBrowser } from '../../../src/map/workspace/catalog.js';
import { createApiRouter } from '../../../tools/api/router.js';
import { getIndexDir } from '../../../src/shared/repo-paths.js';
import { loadUserConfig } from '../../../src/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-artifact-lifetime-'));
const repo = path.join(temp, 'repo'); await fs.mkdir(repo);
applyTestEnv({ cacheRoot: path.join(temp, 'cache') });
const dir = getIndexDir(repo, 'code', loadUserConfig(repo)); await fs.mkdir(dir, { recursive: true });
const filename = path.join(dir, 'chunk_meta.json');
const rows = Array.from({ length: 300 }, (_, id) => ({ id, start: id, end: id + 1, name: 'row' + id }));
await fs.writeFile(filename, JSON.stringify(rows));
await writePiecesManifest(dir, [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' }]);
const handles = [], closed = [], timers = new Map();
let now = 0, sequence = 0, block = false, activeStarted;
const openRows = async function* ({ signal }) {
  const handle = await fs.open(filename, 'r'); handles.push(handle);
  try {
    if (block) {
      activeStarted();
      await new Promise((resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    for (const row of rows) yield row;
  } finally { await handle.close(); closed.push(handle); }
};
const browser = createArtifactBrowser({ clock: () => now, openRows,
  setTimer: callback => { const id = ++sequence; timers.set(id, callback); return id; },
  clearTimer: id => timers.delete(id) });
const routers = [], servers = [];
try {
  const catalog = await browser.catalog(repo);
  const input = { name: 'chunk_meta', generation: catalog.generation };
  const tokens = [];
  for (let i = 0; i < 8; i += 1) tokens.push((await browser.read(repo, input)).cursor);
  assert.equal(handles.length, 8); assert.equal(closed.length, 0);
  now = 60000;
  for (const callback of [...timers.values()]) callback();
  const deadline = Date.now() + 1000;
  while (closed.length < 8 && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed.length, 8, 'idle expiry must close readers without another request');
  await assert.rejects(browser.read(repo, { ...input, cursor: tokens[0] }), /expired/);
  block = true;
  const started = new Promise(resolve => { activeStarted = resolve; });
  const active = browser.read(repo, input);
  const cancelled = assert.rejects(active, { name: 'AbortError' });
  await started;
  const cleanup = browser.close(); assert.strictEqual(browser.close(), cleanup);
  await Promise.all([cleanup, cancelled]);
  assert.equal(closed.length, 9); assert.equal(new Set(closed).size, 9);
  await assert.rejects(browser.catalog(repo), /closed/);

  for (let i = 0; i < 2; i += 1) {
    const router = createApiRouter({ host: '127.0.0.1', defaultRepo: repo }); routers.push(router);
    const server = http.createServer(router.handleRequest); servers.push(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  }
  const post = async (index, route, value) => {
    const response = await fetch('http://127.0.0.1:' + servers[index].address().port + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value)
    });
    return { status: response.status, body: await response.json() };
  };
  const serviceCatalog = (await post(0, '/map/catalog', { repoRoot: repo })).body.result;
  const serviceInput = { repoRoot: repo, name: 'chunk_meta', generation: serviceCatalog.generation };
  let cursor;
  for (let i = 0; i < 8; i += 1) cursor = (await post(0, '/map/artifact', serviceInput)).body.result.cursor;
  assert.equal((await post(1, '/map/artifact', { ...serviceInput, cursor })).status, 410);
  const page = await post(0, '/map/artifact', { ...serviceInput, cursor }); assert.equal(page.status, 200);
  assert.equal((await post(0, '/map/artifact', { ...serviceInput, cursor })).status, 410);
  await routers[0].close();
  assert.equal((await post(0, '/map/catalog', { repoRoot: repo })).status, 503);
  assert.equal((await post(1, '/map/catalog', { repoRoot: repo })).status, 200);
  console.log('Idle descriptor expiry, active close, exactly-once cleanup and router cursor isolation passed.');
} finally {
  await browser.close();
  await Promise.all(routers.map(router => router.close()));
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  await fs.rm(temp, { recursive: true, force: true });
}

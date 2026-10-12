import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createArtifactBrowser } from '../../../src/map/workspace/catalog.js';
import { getIndexDir } from '../../../src/shared/repo-paths.js';
import { loadUserConfig } from '../../../src/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-reader-close-error-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
let browser;
try {
  const dir = getIndexDir(root, 'code', loadUserConfig(root)); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'chunk_meta.json'), '[]');
  await writePiecesManifest(dir, [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' }]);
  let calls = 0, returned = 0;
  const failure = new Error('Owned reader return failed');
  browser = createArtifactBrowser({ openRows: () => ({ [Symbol.asyncIterator]() { return this; },
    async next() { return { done: false, value: { id: calls++, start: 0, end: 1 } }; },
    async return() { returned += 1; throw failure; } }) });
  const catalog = await browser.catalog(root);
  assert.ok((await browser.read(root, { name: 'chunk_meta', generation: catalog.generation })).cursor);
  const closing = browser.close(); assert.strictEqual(browser.close(), closing);
  await assert.rejects(closing, error => error === failure);
  await assert.rejects(browser.catalog(root), /closed/);
  // A cleanup rejection cannot disappear through an active read's allSettled
  // barrier or an earlier idle expiry; close is permanently the same rejection.
  await assert.rejects(browser.close(), error => error === failure);
  assert.equal(returned, 1, 'a failed return is not retried');
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  browser = createArtifactBrowser({ openRows: ({ signal }) => ({ [Symbol.asyncIterator]() { return this; },
    async next() {
      startedResolve();
      await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
      return { done: true };
    }, async return() { returned += 1; throw failure; } }) });
  const active = browser.read(root, { name: 'chunk_meta', generation: catalog.generation });
  const rejected = assert.rejects(active, error => error === failure);
  await started;
  await assert.rejects(browser.close(), error => error === failure);
  await rejected;
  assert.equal(returned, 2);
  let now = 0, expire;
  browser = createArtifactBrowser({ clock: () => now, setTimer: callback => { expire = callback; return 1; }, clearTimer: () => {},
    openRows: () => ({ [Symbol.asyncIterator]() { return this; },
      async next() { return { done: false, value: { id: 1 } }; }, async return() { returned += 1; throw failure; } }) });
  await browser.read(root, { name: 'chunk_meta', generation: catalog.generation }); now = 60000; expire();
  const expiryDeadline = Date.now() + 1000;
  while (returned < 3 && Date.now() < expiryDeadline) await new Promise(resolve => setImmediate(resolve));
  assert.equal(returned, 3);
  await assert.rejects(browser.catalog(root), /cleanup failed/);
  await assert.rejects(browser.close(), error => error === failure);
  assert.equal(returned, 3, 'background expiry failure remains visible at terminal close');
  console.log('Reader close failure remains terminal and visible through idempotent service cleanup.');
} finally { await browser?.close().catch(() => {}); await fs.rm(root, { recursive: true, force: true }); }

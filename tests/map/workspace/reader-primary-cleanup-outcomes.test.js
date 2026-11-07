import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createArtifactBrowser } from '../../../src/map/workspace/catalog.js';
import { getMapReadFailure } from '../../../src/map/shared/read-outcome.js';
import { handleMapArtifactsRoute } from '../../../tools/api/router/map-artifacts.js';
import { getIndexDir } from '../../../src/shared/repo-paths.js';
import { loadUserConfig } from '../../../src/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-reader-primary-cleanup-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const pieces = [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' }];
const open = [];
const rejected = promise => promise.then(() => assert.fail('an authoritative failure cannot become a page'), error => error);
const responseFor = async (browser, input) => {
  const req = new EventEmitter(), res = new EventEmitter(); let response;
  res.writeHead = status => { response = { status }; }; res.end = body => { response.body = JSON.parse(body); };
  await handleMapArtifactsRoute({ req, res, requestUrl: new URL('http://localhost/map/artifact'), corsHeaders: {},
    parseJsonBody: async () => input, resolveRepo: () => root, browser });
  assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
  return response;
};
try {
  const dir = getIndexDir(root, 'code', loadUserConfig(root)); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'chunk_meta.json'), '[]'); await writePiecesManifest(dir, pieces);
  const integrity = Object.freeze(Object.assign(new Error('original integrity failure'), { code: 'ERR_ARTIFACT_INTEGRITY', status: 409 }));
  const cancellation = Object.freeze(Object.assign(new Error('original cancelled read'), { name: 'AbortError', code: 'ABORT_ERR' }));
  let diagnosticReads = 0;
  const hostile = Object.freeze(Object.defineProperties({}, {
    message: { get() { diagnosticReads++; throw undefined; } }, code: { get() { diagnosticReads++; throw false; } },
    stack: { get() { assert.fail('diagnostic projection cannot prepare a stack'); } },
    sceneOwnershipReleased: { get() { assert.fail('read composition cannot copy ownership'); } }
  }));
  const inspected = new Proxy({}, { getOwnPropertyDescriptor(_target, key) {
    if (key === 'code') throw false; return undefined;
  } });
  for (const primary of [integrity, cancellation, new SyntaxError('original decode failure'), 'ordinary thrown text', undefined, null, false, 0, hostile, inspected]) {
    const cleanup = Object.freeze(new Error('independent terminal release failure')); let returns = 0;
    const browser = createArtifactBrowser({ openRows: () => ({ [Symbol.asyncIterator]() { return this; },
      async next() { throw primary; }, async return() { returns++; throw cleanup; } }) }); open.push(browser);
    const catalog = await browser.catalog(root), input = { name: 'chunk_meta', generation: catalog.generation };
    const error = await rejected(browser.read(root, input)), outcome = getMapReadFailure(error);
    assert.equal(outcome.hasPrimary, true); assert.equal(outcome.primary, primary); assert.equal(error.cause, primary);
    assert.deepEqual(error.errors, [primary, cleanup]); assert.equal(outcome.cleanupErrors[0], cleanup);
    assert.equal(outcome.terminal, true); assert.equal(browser.cleanupFailed, true);
    if (primary === inspected) assert(error.mapReadInspectionErrors.includes(false));
    assert.equal(await rejected(browser.close()), cleanup); assert.equal(await rejected(browser.close()), cleanup); assert.equal(returns, 1);
    await assert.rejects(browser.read(root, input), /closed/);
  }
  assert.equal(diagnosticReads, 0, 'optional accessors are never invoked for diagnostics');

  for (const mode of ['generation', 'row-admission']) {
    const cleanup = Object.freeze(new Error('independent validation release failure')); let returns = 0;
    const browser = createArtifactBrowser({ openRows: () => ({ [Symbol.asyncIterator]() { return this; },
      async next() {
        if (mode === 'generation') { await writePiecesManifest(dir, pieces, { buildId: 'replaced-during-read' }); return { done: true }; }
        return { done: false, value: { id: 1, name: 'x'.repeat(65537) } };
      }, async return() { returns++; throw cleanup; } }) }); open.push(browser);
    const input = { name: 'chunk_meta', generation: (await browser.catalog(root)).generation };
    const error = await rejected(browser.read(root, input)), outcome = getMapReadFailure(error);
    assert.equal(outcome.cleanupErrors[0], cleanup);
    if (mode === 'generation') assert.equal(outcome.primary.status, 409); else assert.match(outcome.primary.message, /64 KiB/);
    assert.equal(await rejected(browser.close()), cleanup); assert.equal(returns, 1);
  }

  // An initiating failure stays exact when cleanup succeeds, including a falsey
  // original. It does not poison a separately usable browser.
  for (const primary of [integrity, undefined, false]) {
    let returns = 0;
    const browser = createArtifactBrowser({ openRows: () => ({ [Symbol.asyncIterator]() { return this; },
      async next() { throw primary; }, async return() { returns++; return { done: true }; } }) }); open.push(browser);
    const input = { name: 'chunk_meta', generation: (await browser.catalog(root)).generation };
    assert.equal(await rejected(browser.read(root, input)), primary); assert.equal(browser.cleanupFailed, false);
    await browser.catalog(root); await browser.close(); assert.equal(returns, 1);
  }

  // A continuation consumes its cursor once even when its next read and release
  // both fail. Natural completion has cleanup-only identity, not a fake read.
  for (const continuation of [true, false]) {
    let calls = 0, returns = 0; const cleanup = Object.freeze(new Error('terminal continuation release'));
    const browser = createArtifactBrowser({ openRows: () => ({ [Symbol.asyncIterator]() { return this; },
      async next() { if (!continuation) return { done: true }; if (calls++ < 128) return { done: false, value: { id: calls } }; throw integrity; },
      async return() { returns++; throw cleanup; } }) }); open.push(browser);
    const input = { name: 'chunk_meta', generation: (await browser.catalog(root)).generation };
    if (continuation) {
      const first = await browser.read(root, input); assert(first.cursor);
      const error = await rejected(browser.read(root, { ...input, cursor: first.cursor }));
      assert.equal(getMapReadFailure(error).primary, integrity);
      await assert.rejects(browser.read(root, { ...input, cursor: first.cursor }), /cleanup failed/);
    } else assert.equal(await rejected(browser.read(root, input)), cleanup);
    assert.equal(await rejected(browser.close()), cleanup); assert.equal(returns, 1);
  }

  // Falsey release rejection is still terminal and survives idempotent close.
  for (const cleanup of [undefined, null, false, 0, '']) {
    let returns = 0;
    const browser = createArtifactBrowser({ openRows: () => ({ [Symbol.asyncIterator]() { return this; },
      async next() { return { done: true }; }, async return() { returns++; throw cleanup; } }) }); open.push(browser);
    const input = { name: 'chunk_meta', generation: (await browser.catalog(root)).generation };
    assert.equal(await rejected(browser.read(root, input)), cleanup); assert.equal(browser.cleanupFailed, true);
    await assert.rejects(browser.catalog(root), /cleanup failed/); assert.equal(await rejected(browser.close()), cleanup);
    assert.equal(await rejected(browser.close()), cleanup); assert.equal(returns, 1);
  }

  // The real adapter uses primary classification while independently exposing
  // terminal browser health. It never emits a complete or empty successful page.
  for (const primary of [integrity, cancellation]) {
    const cleanup = Object.freeze(new Error('route cleanup failure'));
    const browser = createArtifactBrowser({ openRows: () => ({ [Symbol.asyncIterator]() { return this; },
      async next() { throw primary; }, async return() { throw cleanup; } }) }); open.push(browser);
    const input = { name: 'chunk_meta', generation: (await browser.catalog(root)).generation };
    const response = await responseFor(browser, input);
    assert.equal(response.status, primary === integrity ? 409 : 499); assert.equal(response.body.ok, false);
    assert.equal(response.body.artifactFailure.read.code, primary.code);
    assert.equal(response.body.artifactFailure.cleanup.failed, true); assert.equal(response.body.artifactFailure.cleanup.terminal, true);
    assert.equal(response.body.artifactFailure.cleanup.failures.length, 1);
    assert.equal(response.body.code, primary === cancellation ? 'CANCELLED' : 'INVALID_REQUEST');
  }
} finally { await Promise.allSettled(open.map(browser => browser.close())); await fs.rm(root, { recursive: true, force: true }); }
console.log('Artifact read primaries and independently terminal cleanup remain distinct through the real catalog and API adapter.');

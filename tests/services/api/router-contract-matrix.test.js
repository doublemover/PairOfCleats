#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import { createApiRouter } from '../../../tools/api/router.js';
import { createSseResponder } from '../../../tools/api/sse.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms))
]);

const runMissingRouteCase = async () => {
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, 'api-router');
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });

  const router = createApiRouter({
    host: '127.0.0.1',
    defaultRepo: tempRoot,
    defaultOutput: 'json',
    metricsRegistry: null
  });

  const server = http.createServer((req, res) => router.handleRequest(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/missing`);
    const payload = await response.json();

    assert.equal(payload.ok, false);
    assert.ok(payload.code);
    assert.ok(payload.namespaceCode);
    assert.ok(typeof payload.hint === 'string' && payload.hint.length > 0);
  } finally {
    server.close();
    if (typeof router.close === 'function') router.close();
  }
};

const runSseBackpressureCase = async () => {
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.headersSent = false;
  res.writableEnded = false;
  res.destroyed = false;
  res.writeHead = () => {
    res.headersSent = true;
  };
  res.write = () => false;
  res.end = () => {
    res.writableEnded = true;
    res.emit('finish');
  };

  const sse = createSseResponder(req, res);

  const headersPromise = withTimeout(sse.sendHeaders(), 200, 'sendHeaders');
  setTimeout(() => res.emit('close'), 10);
  const headersOk = await headersPromise;
  assert.equal(headersOk, false);
  assert.equal(sse.isClosed(), true);

  const eventResult = await withTimeout(sse.sendEvent('progress', { ok: true }), 200, 'sendEvent');
  assert.equal(eventResult, false);
};

await runMissingRouteCase();
await runSseBackpressureCase();

console.log('api router contract matrix test passed');

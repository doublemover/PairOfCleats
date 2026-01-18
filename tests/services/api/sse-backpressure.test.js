#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSseResponder } from '../../../tools/api/sse.js';

const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms))
]);

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

console.log('SSE backpressure test passed');

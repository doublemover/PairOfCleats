#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createFramedJsonRpcParser } from '../../../src/shared/jsonrpc.js';

const frame = (payload) => {
  const body = JSON.stringify(payload);
  return Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};

const messages = [];
const errors = [];
const parser = createFramedJsonRpcParser({
  onMessage: (msg) => messages.push(msg),
  onError: (err) => errors.push(err),
  maxBufferBytes: 256,
  maxHeaderBytes: 128,
  maxMessageBytes: 64
});

parser.push(frame({ jsonrpc: '2.0', id: 1, result: 'ok' }));
assert.equal(messages.length, 1, 'expected one message before overflow');
assert.equal(errors.length, 0, 'did not expect errors for valid payload');

parser.push(frame({ jsonrpc: '2.0', id: 2, result: 'x'.repeat(200) }));
assert.equal(errors.length, 1, 'expected overflow error');
assert.ok(errors[0]?.message?.includes('exceeded'), 'error message should mention size limit');

parser.push(frame({ jsonrpc: '2.0', id: 3, result: 'ok' }));
assert.equal(messages.length, 1, 'parser should stop after overflow');

console.log('jsonrpc parser tests passed');

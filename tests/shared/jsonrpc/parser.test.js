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

{
  const maxHeaderBytes = 64;
  const body = Buffer.from('{}');
  const prefix = 'Content-Length: 2\r\nX-Pad: ';
  const delimiter = Buffer.from('\r\n\r\n');
  for (const extra of [0, 1]) {
    const header = Buffer.from(prefix + 'x'.repeat(maxHeaderBytes + extra - prefix.length));
    for (let split = 0; split < delimiter.length; split += 1) {
      const received = [];
      const failures = [];
      const bounded = createFramedJsonRpcParser({
        maxHeaderBytes, maxBufferBytes: 1024,
        onMessage: (message) => received.push(message),
        onError: (error) => failures.push(error)
      });
      if (split) {
        bounded.push(Buffer.concat([header, delimiter.subarray(0, split)]));
        bounded.push(Buffer.concat([delimiter.subarray(split), body]));
      } else {
        bounded.push(Buffer.concat([header, delimiter, body]));
      }
      assert.equal(failures.length, extra, `header limit must not depend on delimiter split ${split}`);
      assert.deepEqual(received, extra ? [] : [{}]);
      if (extra) {
        assert.match(failures[0].message, /header exceeded/);
        bounded.push(frame({ ignored: true }));
        assert.equal(failures.length, 1, 'header overflow must fail only once');
        assert.equal(received.length, 0, 'header overflow must close the parser');
      }
    }
  }
}

{
  const payloads = [
    { jsonrpc: '2.0', id: 8, result: 'multibyte: 😀 café' },
    { jsonrpc: '2.0', id: 9, result: 'x'.repeat(1024) }
  ];
  const firstBody = Buffer.from(JSON.stringify(payloads[0]));
  const paddedHeader = Buffer.from(`Content-Length: ${firstBody.length}\r\nX-Pad: ${'x'.repeat(512)}\r\n\r\n`);
  const input = Buffer.concat([paddedHeader, firstBody, frame(payloads[1])]);
  const received = [];
  const fragmented = createFramedJsonRpcParser({ onMessage: (message) => received.push(message) });
  const originalIndexOf = Buffer.prototype.indexOf;
  const originalConcat = Buffer.concat;
  const originalCopy = Buffer.prototype.copy;
  const originalShift = Array.prototype.shift;
  let visitedBytes = 0;
  let shifts = 0;
  try {
    Buffer.prototype.indexOf = function (...args) {
      visitedBytes += this.length;
      return originalIndexOf.apply(this, args);
    };
    Buffer.concat = function (list, ...args) {
      for (const chunk of list) visitedBytes += chunk.length;
      return originalConcat.call(this, list, ...args);
    };
    Buffer.prototype.copy = function (target, targetStart, sourceStart = 0, sourceEnd = this.length) {
      visitedBytes += Math.max(0, Math.min(this.length, sourceEnd) - sourceStart);
      return originalCopy.call(this, target, targetStart, sourceStart, sourceEnd);
    };
    Array.prototype.shift = function (...args) {
      shifts += 1;
      return originalShift.apply(this, args);
    };
    for (let offset = 0; offset < input.length; offset += 1) {
      fragmented.push(input.subarray(offset, offset + 1));
    }
  } finally {
    Buffer.prototype.indexOf = originalIndexOf;
    Buffer.concat = originalConcat;
    Buffer.prototype.copy = originalCopy;
    Array.prototype.shift = originalShift;
  }
  assert.deepEqual(received, payloads, 'byte fragments must preserve UTF-8 and adjacent frames');
  assert.ok(visitedBytes <= input.length * 8,
    `fragmented headers/bodies must avoid repeated scanning and copying (${visitedBytes} bytes for ${input.length})`);
  assert.equal(shifts, 0, 'fragment consumption must not shift the whole buffer queue');

  const multiple = Array.from({ length: 80 }, (_, id) => ({ id, result: `value-${id}` }));
  const combined = Buffer.concat(multiple.map(frame));
  const afterCompaction = [];
  const compacting = createFramedJsonRpcParser({ onMessage: (message) => afterCompaction.push(message) });
  for (let offset = 0; offset < combined.length; offset += 37) compacting.push(combined.subarray(offset, offset + 37));
  assert.deepEqual(afterCompaction, multiple, 'partially consumed buffers must preserve adjacent frames');

  const first = { result: 'x'.repeat(4096) };
  const last = { result: 'after compaction' };
  const firstFrame = frame(first);
  const receivedCompacted = [];
  const compacted = createFramedJsonRpcParser({ onMessage: (message) => receivedCompacted.push(message) });
  const originalSplice = Array.prototype.splice;
  let compactions = 0;
  try {
    Array.prototype.splice = function (...args) {
      compactions += 1;
      return originalSplice.apply(this, args);
    };
    for (let offset = 0; offset < firstFrame.length - 1; offset += 32) {
      compacted.push(firstFrame.subarray(offset, Math.min(offset + 32, firstFrame.length - 1)));
    }
    // Completing the first frame leaves the second frame in the same last
    // buffer, forcing compaction of more than 64 consumed fragments.
    compacted.push(Buffer.concat([firstFrame.subarray(-1), frame(last)]));
  } finally {
    Array.prototype.splice = originalSplice;
  }
  assert.ok(compactions > 0, 'the fixture must exercise nonempty queue compaction');
  assert.deepEqual(receivedCompacted, [first, last]);

  const disposed = createFramedJsonRpcParser({ onMessage: () => assert.fail('disposed parser delivered a message') });
  disposed.push(input.subarray(0, 10));
  disposed.dispose();
  disposed.push(input.subarray(10));
}

{
  const header = Buffer.from('Content-Length: 2\r\nX-Pad: a\r\r\n\rX');
  const input = Buffer.concat([header, Buffer.from('\r\n\r\n{}')]);
  const received = [];
  const overlapping = createFramedJsonRpcParser({
    maxHeaderBytes: header.length,
    onMessage: (message) => received.push(message),
    onError: (error) => assert.fail(error.message)
  });
  for (const byte of input) overlapping.push(Buffer.from([byte]));
  assert.deepEqual(received, [{}], 'false delimiter prefixes must resume scanning correctly');

  const reentrantMessages = [];
  const reentrant = createFramedJsonRpcParser({
    onMessage: (message) => {
      reentrantMessages.push(message.id);
      if (message.id === 1) reentrant.push(frame({ id: 3 }));
    }
  });
  reentrant.push(Buffer.concat([frame({ id: 1 }), frame({ id: 2 })]));
  assert.deepEqual(reentrantMessages, [1, 2, 3], 'reentrant input must follow already buffered frames');

  const disposalMessages = [];
  const disposing = createFramedJsonRpcParser({
    onMessage: (message) => {
      disposalMessages.push(message.id);
      disposing.dispose();
    }
  });
  disposing.push(Buffer.concat([frame({ id: 1 }), frame({ id: 2 })]));
  assert.deepEqual(disposalMessages, [1], 'disposal from a callback must discard the remaining frames');
}

console.log('jsonrpc parser tests passed');

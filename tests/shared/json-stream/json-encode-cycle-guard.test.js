#!/usr/bin/env node
import assert from 'node:assert/strict';
import { stringifyJsonValue, writeJsonValue } from '../../../src/shared/json-stream/encode.js';

const circular = { label: 'root' };
circular.self = circular;

assert.throws(
  () => stringifyJsonValue(circular),
  /Circular JSON value/,
  'expected stringifyJsonValue to reject circular payloads'
);

const sinkChunks = [];
const sink = {
  write(chunk) {
    sinkChunks.push(String(chunk));
    return true;
  }
};

let writeError = null;
try {
  await writeJsonValue(sink, circular);
} catch (err) {
  writeError = err;
}
assert.ok(writeError, 'expected writeJsonValue to reject circular payloads');
assert.match(String(writeError?.message || writeError), /Circular JSON value/);

console.log('json encode cycle guard test passed');

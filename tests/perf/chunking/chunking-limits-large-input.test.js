#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyChunkingLimits } from '../../../src/index/chunking/limits.js';

const line = 'abcdefghijklmnopqrstuvwxyz0123456789';
const lines = [];
for (let i = 0; i < 25000; i += 1) {
  lines.push(`${line}${i}`);
}
const text = lines.join('\n');
const input = [{
  start: 0,
  end: text.length,
  name: 'root',
  kind: 'Section',
  meta: {}
}];

const start = Date.now();
const chunks = applyChunkingLimits(input, text, {
  chunking: {
    maxBytes: 512,
    maxLines: 40
  }
});
const durationMs = Date.now() - start;

assert.ok(Array.isArray(chunks) && chunks.length > 100, 'expected substantial chunk output for large input');
assert.ok(durationMs < 15000, `expected chunking-limits run under 15s, got ${durationMs}ms`);
for (let i = 0; i < Math.min(chunks.length, 200); i += 1) {
  const chunk = chunks[i];
  const slice = text.slice(chunk.start, chunk.end);
  assert.ok(Buffer.byteLength(slice, 'utf8') <= 512, 'expected maxBytes bound');
}

console.log(`chunking limits large input test passed in ${durationMs}ms`);

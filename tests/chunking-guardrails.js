#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyChunkingLimits } from '../src/index/chunking/limits.js';

const guardrailMaxBytes = 200 * 1024;

const largeText = 'a'.repeat(guardrailMaxBytes + 1024);
const largeChunks = [{ start: 0, end: largeText.length }];
const splitChunks = applyChunkingLimits(largeChunks, largeText, {});
assert.ok(splitChunks.length > 1, 'expected guardrail chunk splitting for large text');
for (const chunk of splitChunks) {
  const bytes = Buffer.byteLength(largeText.slice(chunk.start, chunk.end), 'utf8');
  assert.ok(bytes <= guardrailMaxBytes, `expected chunk <= ${guardrailMaxBytes} bytes`);
}

const smallText = 'short text';
const smallChunks = [{ start: 0, end: smallText.length }];
const untouched = applyChunkingLimits(smallChunks, smallText, {});
assert.equal(untouched.length, 1, 'expected small text to remain a single chunk');

console.log('chunking guardrails test passed');

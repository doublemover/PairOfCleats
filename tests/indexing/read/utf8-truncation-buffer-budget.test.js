#!/usr/bin/env node
import assert from 'node:assert/strict';
import { truncateByBytes } from '../../../src/index/build/file-processor/read.js';
import { collectChunkComments } from '../../../src/index/build/file-processor/process-chunks/limits.js';

// Retain the previous byte-boundary implementation as the semantic oracle.
const legacy = (value, maxBytes) => {
  const text = typeof value === 'string' ? value : '';
  const limit = Number.isFinite(Number(maxBytes)) ? Number(maxBytes) : 0;
  if (!limit || Buffer.byteLength(text, 'utf8') <= limit) {
    return { text, truncated: false, bytes: Buffer.byteLength(text, 'utf8') };
  }
  const buffer = Buffer.from(text, 'utf8');
  const boundary = (buf, end) => {
    let cursor = Math.min(end, buf.length);
    if (cursor <= 0 || cursor === buf.length) return cursor;
    let start = cursor;
    while (start > 0 && (buf[start] & 0xc0) === 0x80) start -= 1;
    if (start === cursor) return cursor;
    const lead = buf[start];
    let expected = 1;
    if ((lead & 0x80) === 0) expected = 1;
    else if ((lead & 0xe0) === 0xc0) expected = 2;
    else if ((lead & 0xf0) === 0xe0) expected = 3;
    else if ((lead & 0xf8) === 0xf0) expected = 4;
    else return start;
    return start + expected <= cursor ? cursor : start;
  };
  const end = boundary(buffer, limit);
  return { text: buffer.toString('utf8', 0, end), truncated: true, bytes: end };
};
const samples = [
  '', 'ASCII\r\nline\n', '\uFEFFcafé 東京 😀 tail', '\0one\0two',
  'e\u0301 👩‍💻 end', '\ud800alone\udfff', 'a\ud83d\ude00b',
  Array.from({ length: 64 }, (_, index) => String.fromCharCode((index * 977) & 0xffff)).join('')
];
let comparisons = 0;
for (const text of samples) {
  for (let limit = 0; limit <= Buffer.byteLength(text, 'utf8') + 2; limit += 1) {
    assert.deepEqual(truncateByBytes(text, limit), legacy(text, limit));
    comparisons += 1;
  }
  for (const limit of [undefined, null, NaN, Infinity, -1, -2.5, 0.5, 1.5, '3']) {
    assert.deepEqual(truncateByBytes(text, limit), legacy(text, limit), 'legacy non-integer/uncapped inputs remain compatible');
  }
}
for (const value of [null, undefined, 123, {}, []]) assert.deepEqual(truncateByBytes(value, 3), legacy(value, 3));

const source = 'abc 😀東京\r\n'.repeat(1024);
const budget = 31;
const expected = legacy(source, budget);
const originalFrom = Buffer.from;
const originalAllocate = Buffer.allocUnsafe;
let fullSourceEncodedBytes = 0;
let largestAllocation = 0;
Buffer.from = function (input, ...options) {
  if (input === source) fullSourceEncodedBytes += Buffer.byteLength(input, 'utf8');
  return originalFrom.call(this, input, ...options);
};
Buffer.allocUnsafe = function (size) {
  largestAllocation = Math.max(largestAllocation, size);
  return originalAllocate.call(this, size);
};
try {
  const result = collectChunkComments({
    assigned: [{ type: 'block', style: 'block', text: source, start: 0, end: source.length, startLine: 1, endLine: 1025 }],
    assignedRanges: [], chunkMode: 'prose', chunkStart: 0, effectiveExt: '.js',
    normalizedCommentsConfig: { maxPerChunk: 5, maxBytesPerChunk: budget, includeLicense: false },
    tokenDictWords: new Set(), dictConfig: {}, includeTokens: false
  });
  assert.equal(result.docmetaPatch.comments[0].text, expected.text);
  assert.equal(result.docmetaPatch.comments[0].truncated, true);
  assert.deepEqual(result.commentFieldTokens, []);
  assert.equal(fullSourceEncodedBytes, 0, 'a clipped comment should not first encode its entire source into a buffer');
  assert.ok(largestAllocation <= budget, 'temporary encoded bytes follow the retained byte budget');
} finally {
  Buffer.from = originalFrom;
  Buffer.allocUnsafe = originalAllocate;
}
console.log(`UTF-8 truncation buffer budget passed: ${comparisons} prefix comparisons and actual bounded comment collector`);

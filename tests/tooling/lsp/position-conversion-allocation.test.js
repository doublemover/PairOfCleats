#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { positionToOffset, rangeToOffsets } from '../../../src/integrations/tooling/lsp/positions.js';

// Preserve the prior per-code-point substring/byte-length conversion as oracle.
const legacy = (index, text, position, encoding) => {
  const line = Math.max(0, Math.floor(Number(position.line) || 0));
  const start = index[line] ?? index[index.length - 1] ?? 0;
  let end = Number.isFinite(index[line + 1]) ? Math.max(start, Math.min(text.length, index[line + 1])) : text.length;
  if (end > start && text[end - 1] === '\n') end -= 1;
  if (end > start && text[end - 1] === '\r') end -= 1;
  const target = Math.max(0, Math.floor(Number(position.character) || 0));
  if (encoding === 'utf-16') return Math.max(start, Math.min(end, start + Math.max(0, Number(position.character) || 0)));
  let current = start;
  let consumed = 0;
  while (current < end && consumed < target) {
    const codePoint = text.codePointAt(current);
    if (codePoint == null) break;
    const width = codePoint > 0xffff ? 2 : 1;
    const slice = text.slice(current, current + width);
    const units = encoding === 'utf-32' ? 1 : Buffer.byteLength(slice, 'utf8');
    if (consumed + units > target) break;
    consumed += units;
    current += width;
  }
  return current;
};
const samples = [
  '', 'ASCII\r\nlast', '\0é東京😀\nnext', 'e\u0301 👩‍💻\r\n',
  '\ud800x\udfff\n\ud83d\ude00', '\uFEFFone\r\n\r\nthree',
  Array.from({ length: 96 }, (_, i) => String.fromCharCode((i * 997) & 0xffff)).join('')
];
let comparisons = 0;
for (const text of samples) {
  const index = buildLineIndex(text);
  for (const encoding of ['utf-8', 'utf-32', 'utf-16']) {
    for (const line of [-1, ...Array.from({ length: index.length + 2 }, (_, i) => i)]) {
      for (let character = 0; character <= Buffer.byteLength(text, 'utf8') + 2; character += 1) {
        const position = { line, character };
        assert.equal(positionToOffset(index, position, { text, positionEncoding: encoding }), legacy(index, text, position, encoding));
        comparisons += 1;
      }
    }
  }
}
const text = `header\r\n${'aé東京😀'.repeat(32)}\r\nfooter`;
const index = buildLineIndex(text);
const range = { start: { line: 1, character: 5 }, end: { line: 1, character: 64 } };
const expected = {};
for (const encoding of ['utf-8', 'utf-32']) {
  expected[encoding] = { start: legacy(index, text, range.start, encoding), end: legacy(index, text, range.end, encoding) };
}
const originalSlice = String.prototype.slice;
const originalByteLength = Buffer.byteLength;
let sourceSlices = 0;
let byteLengthCalls = 0;
String.prototype.slice = function (...args) {
  if (String(this) === text) sourceSlices += 1;
  return originalSlice.apply(this, args);
};
Buffer.byteLength = function (...args) {
  byteLengthCalls += 1;
  return originalByteLength.apply(this, args);
};
try {
  for (const encoding of ['utf-8', 'utf-32']) {
    assert.deepEqual(rangeToOffsets(index, range, { text, positionEncoding: encoding }), expected[encoding]);
  }
  assert.equal(sourceSlices, 0, 'coordinate conversion must not allocate a substring for each traversed code point');
  assert.equal(byteLengthCalls, 0, 'UTF-8 width is known from the code point without encoding a substring');
} finally {
  String.prototype.slice = originalSlice;
  Buffer.byteLength = originalByteLength;
}
console.log(`LSP position conversion allocation passed: ${comparisons} Unicode/CRLF/boundary comparisons and actual range conversion`);

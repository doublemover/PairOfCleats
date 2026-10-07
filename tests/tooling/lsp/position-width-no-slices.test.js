#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { positionToOffset, rangeToOffsets } from '../../../src/integrations/tooling/lsp/positions.js';

// Independent copy of the previous per-code-point encoding rule.
const reference = (text, index, line, character, encoding) => {
  const lineNumber = Math.max(0, Math.floor(Number(line) || 0));
  const start = index[lineNumber] ?? index[index.length - 1] ?? 0;
  let end = index[lineNumber + 1] ?? text.length;
  if (end > start && text[end - 1] === '\n') end--;
  if (end > start && text[end - 1] === '\r') end--;
  const target = Math.max(0, Math.floor(Number(character) || 0));
  let offset = start;
  let consumed = 0;
  while (offset < end && consumed < target) {
    const width = text.codePointAt(offset) > 0xFFFF ? 2 : 1;
    const units = encoding === 'utf-32' ? 1 : Buffer.byteLength(text.slice(offset, offset + width), 'utf8');
    if (consumed + units > target) break;
    consumed += units;
    offset += width;
  }
  return offset;
};

const examples = ['', 'ascii', 'é中🙂𝄞', '\ud800', '\udfff', '\ud800x\udfff',
  '\ud800\ud800\udc00\udfff', 'a\r\n🙂\r\n\udfff\n', '\u007f\u0080\u07ff\u0800\uffff𐀀􏿿'];
let seed = 0x13579;
for (let i = 0; i < 256; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  examples.push(String.fromCharCode(seed & 0xFFFF) + String.fromCodePoint(seed % 0x110000) + 'é🙂');
}
let comparisons = 0;
for (const text of examples) {
  const index = buildLineIndex(text);
  for (const encoding of ['utf-8', 'utf-32']) {
    for (let line = 0; line <= index.length; line++) {
      for (let character = 0; character <= Buffer.byteLength(text) + 2; character++) {
        assert.equal(positionToOffset(index, { line, character }, { text, positionEncoding: encoding }),
          reference(text, index, line, character, encoding));
        comparisons++;
      }
    }
  }
}

const text = 'aé中🙂𝄞\ud800';
const index = buildLineIndex(text);
const originalSlice = String.prototype.slice;
const originalByteLength = Buffer.byteLength;
let slices = 0;
let byteScans = 0;
try {
  String.prototype.slice = function(...args) { slices++; return originalSlice.apply(this, args); };
  Buffer.byteLength = (...args) => { byteScans++; return originalByteLength(...args); };
  for (const positionEncoding of ['utf-8', 'utf-32']) {
    assert.deepEqual(rangeToOffsets(index, {
      start: { line: 0, character: 0 }, end: { line: 0, character: 100 }
    }, { text, positionEncoding }), { start: 0, end: text.length });
  }
} finally {
  String.prototype.slice = originalSlice;
  Buffer.byteLength = originalByteLength;
}
assert.equal(slices, 0, 'coordinate conversion must not allocate per-code-point slices');
assert.equal(byteScans, 0, 'coordinate conversion must derive widths without repeated UTF-8 encoding scans');
console.log(`LSP position width parity passed (${comparisons} comparisons); no per-code-point slices or byte scans`);

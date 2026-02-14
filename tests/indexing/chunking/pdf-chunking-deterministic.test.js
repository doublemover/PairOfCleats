#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chunkPdfDocument } from '../../../src/index/chunking/formats/pdf.js';

const buildPdfTextAndUnits = (pages) => {
  const units = [];
  const parts = [];
  let cursor = 0;
  for (let i = 0; i < pages.length; i += 1) {
    const text = String(pages[i] || '');
    const start = cursor;
    parts.push(text);
    cursor += text.length;
    units.push({
      type: 'pdf',
      pageNumber: i + 1,
      start,
      end: cursor
    });
    if (i + 1 < pages.length) {
      parts.push('\n\n');
      cursor += 2;
    }
  }
  return {
    text: parts.join(''),
    units
  };
};

const pages = [
  'A'.repeat(520),
  'B'.repeat(640),
  'C'.repeat(700)
];
const fixture = buildPdfTextAndUnits(pages);
const context = {
  documentExtraction: {
    sourceType: 'pdf',
    units: fixture.units
  }
};

const first = chunkPdfDocument(fixture.text, context);
const second = chunkPdfDocument(fixture.text, context);

assert.deepEqual(first, second, 'expected deterministic PDF chunks');
assert.equal(first.length, 3, 'expected one chunk per non-tiny PDF page');
for (let i = 0; i < first.length; i += 1) {
  const chunk = first[i];
  const pageNumber = i + 1;
  assert.equal(chunk.segment?.type, 'pdf', 'expected pdf segment type');
  assert.equal(chunk.segment?.pageStart, pageNumber, 'expected pageStart to match page');
  assert.equal(chunk.segment?.pageEnd, pageNumber, 'expected pageEnd to match page');
  assert.ok(
    /^pdf:\d+-\d+:[a-f0-9]{12}$/.test(String(chunk.segment?.anchor || '')),
    'expected deterministic PDF anchor format'
  );
}

const tinyFixture = buildPdfTextAndUnits(['x'.repeat(20), 'y'.repeat(24), 'z'.repeat(22)]);
const merged = chunkPdfDocument(tinyFixture.text, {
  documentExtraction: { sourceType: 'pdf', units: tinyFixture.units },
  chunking: { minCharsPerChunk: 40, maxCharsPerChunk: 2400 }
});
assert.equal(merged.length, 2, 'expected deterministic adjacent merge for tiny pages');
assert.equal(merged[0]?.segment?.pageStart, 1, 'expected merged tiny pages to start at page 1');
assert.equal(merged[0]?.segment?.pageEnd, 2, 'expected merged tiny pages to end at page 2');

console.log('pdf chunking deterministic test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chunkDocxDocument } from '../../../src/index/chunking/formats/docx.js';

const buildDocxTextAndUnits = (paragraphs) => {
  const units = [];
  const parts = [];
  let cursor = 0;
  for (let i = 0; i < paragraphs.length; i += 1) {
    const paragraph = paragraphs[i] || {};
    const text = String(paragraph.text || '');
    const start = cursor;
    parts.push(text);
    cursor += text.length;
    units.push({
      type: 'docx',
      index: i + 1,
      style: paragraph.style || null,
      start,
      end: cursor
    });
    if (i + 1 < paragraphs.length) {
      parts.push('\n\n');
      cursor += 2;
    }
  }
  return {
    text: parts.join(''),
    units
  };
};

const fixture = buildDocxTextAndUnits([
  { text: 'Overview', style: 'Heading1' },
  { text: 'A'.repeat(90) },
  { text: 'B'.repeat(70) },
  { text: 'Details', style: 'Heading2' },
  { text: 'C'.repeat(90) }
]);

const context = {
  documentExtraction: {
    sourceType: 'docx',
    units: fixture.units
  },
  chunking: {
    minCharsPerChunk: 100,
    maxCharsPerChunk: 180
  }
};

const first = chunkDocxDocument(fixture.text, context);
const second = chunkDocxDocument(fixture.text, context);

assert.deepEqual(first, second, 'expected deterministic DOCX chunks');
assert.ok(first.length >= 2, 'expected multiple DOCX chunks');
assert.equal(first[0]?.segment?.paragraphStart, 1, 'expected first chunk to start at first paragraph');
assert.ok(
  Array.isArray(first[0]?.segment?.headingPath) && first[0].segment.headingPath.length >= 1,
  'expected first chunk headingPath'
);
const detailsChunk = first.find((chunk) => Number(chunk?.segment?.paragraphStart) >= 4);
assert.ok(detailsChunk, 'expected chunk boundary at Heading2 paragraph');
assert.ok(
  /^docx:\d+-\d+:[a-f0-9]{12}$/.test(String(detailsChunk?.segment?.anchor || '')),
  'expected deterministic DOCX anchor format'
);
assert.ok(
  first.some((chunk) => chunk?.segment?.boundaryLabel === 'merged_paragraphs'),
  'expected merged paragraph boundary label for grouped chunks'
);

console.log('docx chunking deterministic test passed');

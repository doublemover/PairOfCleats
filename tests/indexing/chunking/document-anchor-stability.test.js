#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildDocumentAnchor } from '../../../src/index/chunking/formats/document-common.js';
import { chunkPdfDocument } from '../../../src/index/chunking/formats/pdf.js';

const anchorA = buildDocumentAnchor({
  type: 'pdf',
  start: 1,
  end: 1,
  textSlice: 'Alpha\r\nBeta'
});
const anchorB = buildDocumentAnchor({
  type: 'pdf',
  start: 1,
  end: 1,
  textSlice: '  Alpha \n  Beta  '
});
assert.equal(anchorA, anchorB, 'expected anchor normalization stability across newline/spacing variants');
assert.ok(/^pdf:\d+-\d+:[a-f0-9]{12}$/.test(anchorA), 'expected anchor format contract');

const textOne = 'Alpha\r\nBeta';
const textTwo = '  Alpha \n  Beta  ';
const unitsOne = [{ type: 'pdf', pageNumber: 1, start: 0, end: textOne.length }];
const unitsTwo = [{ type: 'pdf', pageNumber: 1, start: 0, end: textTwo.length }];
const chunkOne = chunkPdfDocument(textOne, { documentExtraction: { sourceType: 'pdf', units: unitsOne } });
const chunkTwo = chunkPdfDocument(textTwo, { documentExtraction: { sourceType: 'pdf', units: unitsTwo } });
assert.equal(chunkOne.length, 1, 'expected one PDF chunk for single-page input');
assert.equal(chunkTwo.length, 1, 'expected one PDF chunk for single-page input variant');
assert.equal(
  chunkOne[0]?.segment?.anchor,
  chunkTwo[0]?.segment?.anchor,
  'expected stable chunk anchors for normalized equivalent content'
);

console.log('document anchor stability test passed');

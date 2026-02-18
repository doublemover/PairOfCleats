#!/usr/bin/env node
import assert from 'node:assert/strict';
import { extractPdf, loadPdfExtractorRuntime } from '../../../src/index/extractors/pdf.js';
import { buildMinimalPdfBuffer } from '../../helpers/document-fixtures.js';
import { skip } from '../../helpers/skip.js';

const runtime = await loadPdfExtractorRuntime({ refresh: true });
if (!runtime?.ok) {
  skip('pdf extractor unavailable; skipping smoke test.');
}

const marker = 'phase17 pdf smoke marker';
const result = await extractPdf({
  buffer: buildMinimalPdfBuffer(marker)
});

assert.equal(result?.ok, true, 'expected extractPdf smoke to succeed');
assert.ok(Array.isArray(result.pages) && result.pages.length > 0, 'expected at least one extracted page');
const combined = result.pages.map((page) => String(page?.text || '')).join('\n');
assert.ok(
  combined.toLowerCase().includes('phase17')
  && combined.toLowerCase().includes('smoke'),
  'expected extracted PDF text to contain marker'
);

console.log('pdf smoke test passed');

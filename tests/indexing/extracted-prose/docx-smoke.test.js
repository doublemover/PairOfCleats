#!/usr/bin/env node
import assert from 'node:assert/strict';
import { extractDocx, loadDocxExtractorRuntime } from '../../../src/index/extractors/docx.js';
import { buildMinimalDocxBuffer } from '../../helpers/document-fixtures.js';
import { skip } from '../../helpers/skip.js';

const runtime = await loadDocxExtractorRuntime({ refresh: true });
if (!runtime?.ok) {
  skip('docx extractor unavailable; skipping smoke test.');
}

const marker = 'phase17 docx smoke marker';
const result = await extractDocx({
  buffer: buildMinimalDocxBuffer([marker, 'second paragraph'])
});

assert.equal(result?.ok, true, 'expected extractDocx smoke to succeed');
assert.ok(
  Array.isArray(result.paragraphs) && result.paragraphs.length >= 1,
  'expected extracted docx paragraphs'
);
const combined = result.paragraphs.map((paragraph) => String(paragraph?.text || '')).join('\n');
assert.ok(
  combined.toLowerCase().includes('phase17')
  && combined.toLowerCase().includes('docx'),
  'expected extracted DOCX text to contain marker'
);

console.log('docx smoke test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildMetaV2 } from '../../../src/index/metadata-v2.js';
import { validateMetaV2Equivalence } from '../../../src/index/validate/checks.js';

const buildReport = () => ({
  issues: [],
  warnings: [],
  hints: []
});

const chunk = {
  id: 0,
  file: 'src/app.ts',
  ext: '.ts',
  start: 0,
  end: 12,
  startLine: 1,
  endLine: 1,
  lang: 'typescript',
  docmeta: {
    signature: 'greet(name: string): string',
    doc: 'greet docs'
  }
};

const toolInfo = { tool: 'pairofcleats', version: '0.0.0-test' };
const metaV2 = buildMetaV2({
  chunk,
  docmeta: chunk.docmeta,
  toolInfo,
  analysisPolicy: { metadata: { enabled: true } }
});

const entry = { ...chunk, metaV2 };

const report = buildReport();
validateMetaV2Equivalence(report, 'code', [entry], { maxSamples: 5, maxErrors: 2 });
assert.equal(report.issues.length, 0, `unexpected metaV2 mismatch: ${report.issues.join(', ')}`);

const mutated = { ...entry, metaV2: { ...metaV2, ext: '.js' } };
const reportMismatch = buildReport();
validateMetaV2Equivalence(reportMismatch, 'code', [mutated], { maxSamples: 5, maxErrors: 2 });
assert.ok(reportMismatch.issues.length > 0, 'expected metaV2 mismatch to be detected');

console.log('metaV2 recompute equivalence ok');

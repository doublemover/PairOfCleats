#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeSnippet } from '../../../src/retrieval/output/format/shared.js';
import { formatShortChunk } from '../../../src/retrieval/output/format/short.js';
import { formatFullChunk } from '../../../src/retrieval/output/format/full.js';
import { compactHit } from '../../../src/retrieval/cli/render-output.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';

const family = '👩‍💻';
const legacy = (value, limit = 140) => {
  const raw = String(value || '').replace(/\s+/gu, ' ').trim();
  return raw.length > limit ? `${raw.slice(0, Math.max(0, limit - 3))}...` : raw;
};
const samples = ['aa😀tail', `aa${family}tail`, 'e\u0301'.repeat(12), '資料'.repeat(20)];
for (const value of samples) {
  for (const budget of [0, 1, 2, 3, 4, 6, 8, 16, 24]) {
    const actual = normalizeSnippet(value, budget);
    assert.ok(actual.length <= budget, 'snippet budgets count UTF-16 units, not terminal display cells');
    assert.ok(actual.isWellFormed(), 'clipping must not create a partial Unicode code point');
    assert.ok(!actual.endsWith('\u200d'), 'clipping must retain complete joiner sequences');
    assert.equal(actual.replaceAll(family, '').includes('\u200d'), false);
    if (actual.includes('e') && value.startsWith('e\u0301')) {
      assert.equal(actual.replaceAll('e\u0301', '').includes('e'), false, 'do not detach the combining accent');
    }
  }
}
for (const budget of [6, 12, 140, 220]) {
  assert.equal(normalizeSnippet('  ordinary\nASCII  excerpt '.repeat(20), budget), legacy('  ordinary\nASCII  excerpt '.repeat(20), budget));
}
assert.equal(normalizeSnippet('aa😀tail', '6'), 'aa...');
for (const budget of [Infinity, NaN, -1, 3.5]) assert.equal(normalizeSnippet('ordinary excerpt', budget), legacy('ordinary excerpt', budget));

const color = Object.fromEntries(['red', 'bold', 'yellow', 'green', 'gray', 'cyan'].map((key) => [key, String]));
for (const [formatter, limit] of [[formatShortChunk, 140], [formatFullChunk, 220]]) {
  for (const mode of ['prose', 'extracted-prose', 'records']) {
    const headline = `${'x'.repeat(limit - 4)}😀longer tail`;
    const chunk = { id: 7, file: 'docs/example.md', name: 'Snippet example', kind: 'Section',
      headline, start: 0, end: headline.length, startLine: 1, endLine: 2,
      docmeta: { doc: headline, commentExcerpt: headline } };
    const original = structuredClone(chunk);
    const output = stripAnsi(formatter({ chunk, index: 0, mode, color, allowSummary: false,
      layout: { columns: 72, contentWidth: 68, cacheKey: 'snippet:72' }, _skipCache: true }));
    assert.ok(output.isWellFormed(), 'actual result rendering must not emit a split surrogate');
    assert.ok(output.includes(`${'x'.repeat(limit - 4)}...`));
    assert.deepEqual(chunk, original, 'display clipping must not mutate source metadata');
    assert.equal(compactHit(chunk).headline, headline, 'machine output retains the full headline');
  }
}
console.log('Snippet grapheme budgets passed: whole emoji/combining groups, ASCII/tiny controls, actual compact/full formatters and machine identity');

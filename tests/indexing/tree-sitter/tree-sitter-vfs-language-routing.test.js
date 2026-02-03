#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveTreeSitterLanguagesForSegments } from '../../../src/index/build/file-processor/tree-sitter.js';

const segments = [
  { type: 'embedded', languageId: 'javascript', start: 0, end: 10 },
  { type: 'embedded', languageId: 'css', start: 10, end: 20 },
  { type: 'prose', languageId: 'markdown', start: 20, end: 30 }
];

const result = resolveTreeSitterLanguagesForSegments({
  segments,
  primaryLanguageId: 'html',
  ext: '.html',
  treeSitterConfig: { enabled: true }
});

const expected = new Set(['html', 'javascript', 'css']);
assert.equal(result.length, expected.size, 'expected embedded languages to be included');
for (const lang of result) {
  assert.ok(expected.has(lang), `unexpected language ${lang}`);
}

console.log('tree-sitter vfs language routing ok');

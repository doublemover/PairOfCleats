#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildFilterIndex } from '../../src/retrieval/filter-index.js';

const meta = [
  {
    id: 0,
    file: 'docs/guide.md',
    ext: '.md',
    metaV2: { lang: 'typescript', effective: { languageId: 'typescript' } }
  },
  {
    id: 1,
    file: 'src/app.js',
    ext: '.js',
    metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } }
  }
];

const index = buildFilterIndex(meta);
assert.ok(index.byLang, 'expected byLang to be present');
assert.ok(index.byLang.get('typescript')?.has(0), 'expected typescript bucket to include chunk 0');
assert.ok(index.byLang.get('javascript')?.has(1), 'expected javascript bucket to include chunk 1');

console.log('filter index byLang test passed');

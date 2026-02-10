#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';

const chunks = [
  {
    id: 0,
    file: 'src/no-lang.js',
    ext: '.js',
    metaV2: {}
  },
  {
    id: 1,
    file: 'src/invalid-lang.ts',
    ext: '.ts',
    metaV2: {
      lang: { id: 'typescript' },
      effective: { languageId: '' }
    },
    lang: '   '
  },
  {
    id: 2,
    file: 'src/valid.py',
    ext: '.py',
    metaV2: {
      effective: { languageId: 'Python' }
    }
  }
];

const index = buildFilterIndex(chunks, { includeBitmaps: false });
const unknown = index.byLang.get('unknown');
assert.ok(unknown && unknown.has(0), 'missing language should fall back to unknown');
assert.ok(unknown && unknown.has(1), 'invalid language should fall back to unknown');

const python = index.byLang.get('python');
assert.ok(python && python.has(2), 'valid effective language should be normalized and indexed');

console.log('effective lang fallback test passed');

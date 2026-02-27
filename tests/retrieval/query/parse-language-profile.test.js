#!/usr/bin/env node
import assert from 'node:assert/strict';
import { tokenizeQueryTerms } from '../../../src/retrieval/query-parse.js';

const dict = new Set();

const stemmed = tokenizeQueryTerms(
  ['running tests'],
  dict,
  { caseSensitive: false, stemming: 'auto', language: 'en' }
);
assert.ok(stemmed.includes('running'), 'expected original token to remain');
assert.ok(stemmed.includes('run'), 'expected english stemming expansion token');

const cjkExpanded = tokenizeQueryTerms(
  ['検索機能'],
  dict,
  {
    caseSensitive: false,
    language: 'ja',
    cjkFallback: true,
    cjkMinGram: 2,
    cjkMaxGram: 2
  }
);
assert.ok(cjkExpanded.includes('検索機能'), 'expected original CJK token to remain');
assert.ok(cjkExpanded.includes('検索'), 'expected CJK bigram expansion');
assert.ok(cjkExpanded.includes('機能'), 'expected CJK bigram tail expansion');

const hooked = tokenizeQueryTerms(
  ['tokenized'],
  dict,
  {
    caseSensitive: false,
    tokenHook: (token) => `${token}_hook`
  }
);
assert.ok(hooked.includes('tokenized_hook'), 'expected tokenHook expansion token');

console.log('query parse language profile test passed');

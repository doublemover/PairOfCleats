#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveFtsVariant } from '../../../src/retrieval/fts-query.js';

const unicodeDefault = resolveFtsVariant({ query: 'resume' });
assert.equal(unicodeDefault.variant, 'unicode61', 'expected default unicode61 variant');
assert.equal(unicodeDefault.tokenizer, 'unicode61 remove_diacritics 2', 'expected diacritic default tokenizer');
assert.equal(unicodeDefault.reason, 'default_unicode61', 'expected default reason');

const stemming = resolveFtsVariant({ query: 'running tests', stemmingEnabled: true });
assert.equal(stemming.variant, 'porter', 'expected porter variant when stemming override is enabled for latin');
assert.equal(stemming.reason, 'stemming_override', 'expected stemming override reason');

const cjk = resolveFtsVariant({ query: '検索', stemmingEnabled: true });
assert.equal(cjk.variant, 'trigram', 'expected trigram for CJK query');
assert.equal(cjk.reason, 'cjk_or_emoji', 'expected CJK reason');

const substring = resolveFtsVariant({ query: 'path', substringMode: true });
assert.equal(substring.variant, 'trigram', 'expected trigram for substring mode');
assert.equal(substring.reason, 'substring_mode', 'expected substring reason');

const nfkc = resolveFtsVariant({ query: 'Ａ' });
assert.equal(nfkc.normalizedQuery, 'A', 'expected NFKC normalized query');
assert.equal(nfkc.normalizedChanged, true, 'expected normalization change marker');
assert.equal(nfkc.reasonPath, 'default_unicode61+nfkc_normalized', 'expected normalized reason path suffix');

console.log('fts tokenizer config test passed');

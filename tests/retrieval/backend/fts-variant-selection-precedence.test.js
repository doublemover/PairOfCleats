#!/usr/bin/env node
import assert from 'node:assert/strict';
import { compileFtsMatchQuery } from '../../../src/retrieval/fts-query.js';

const explicit = compileFtsMatchQuery({
  query: 'abc',
  queryTokens: ['abc'],
  explicitTrigram: true,
  substringMode: true,
  stemmingEnabled: true
});
assert.equal(explicit.variant, 'trigram', 'expected explicit trigram to win precedence');
assert.equal(explicit.reason, 'explicit_trigram', 'expected explicit trigram reason');

const cjk = compileFtsMatchQuery({
  query: '東京',
  queryTokens: ['東京'],
  stemmingEnabled: true
});
assert.equal(cjk.variant, 'trigram', 'expected CJK to select trigram');
assert.equal(cjk.reason, 'cjk_or_emoji', 'expected CJK reason');

const substring = compileFtsMatchQuery({
  query: 'foo',
  queryTokens: ['foo'],
  substringMode: true,
  stemmingEnabled: true
});
assert.equal(substring.variant, 'trigram', 'expected substring mode to select trigram before stemming');
assert.equal(substring.reason, 'substring_mode', 'expected substring reason');

const stemming = compileFtsMatchQuery({
  query: 'running',
  queryTokens: ['running'],
  stemmingEnabled: true
});
assert.equal(stemming.variant, 'porter', 'expected latin stemming override to select porter');
assert.equal(stemming.reason, 'stemming_override', 'expected stemming override reason');

const defaultVariant = compileFtsMatchQuery({
  query: 'resume',
  queryTokens: ['resume']
});
assert.equal(defaultVariant.variant, 'unicode61', 'expected unicode61 fallback variant');
assert.equal(defaultVariant.reason, 'default_unicode61', 'expected unicode fallback reason');

const nfkc = compileFtsMatchQuery({
  query: 'ＡＢ',
  queryTokens: ['ab']
});
assert.equal(nfkc.normalizedChanged, true, 'expected normalization change flag');
assert.equal(nfkc.reasonPath, 'default_unicode61+nfkc_normalized', 'expected NFKC reason path suffix');

console.log('fts variant selection precedence test passed');

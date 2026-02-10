#!/usr/bin/env node
import { buildChargramsFromTokens, createTokenizationContext, tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { forEachRollingChargramHash } from '../../../src/shared/chargram-hash.js';

const context = createTokenizationContext({
  dictWords: new Set(),
  dictConfig: { segmentation: 'greedy' },
  postingsConfig: {
    enableChargrams: true,
    chargramMinN: 3,
    chargramMaxN: 3,
    chargramMaxTokenLength: 5,
    chargramSource: 'full'
  }
});

const payload = tokenizeChunkText({
  text: 'short veryverylongtoken',
  mode: 'code',
  ext: '.js',
  context
});

let longGram = null;
forEachRollingChargramHash('veryverylongtoken', 3, 3, { maxTokenLength: null }, (g) => {
  longGram = g;
  return false;
});
const chargrams = buildChargramsFromTokens(payload.tokens, context);
if (longGram && chargrams.includes(longGram)) {
  console.error('chargram guardrail test failed: long token chargrams should be skipped.');
  process.exit(1);
}

const fieldPayload = tokenizeChunkText({
  text: 'short',
  mode: 'code',
  ext: '.js',
  context
});
let fieldGram = null;
forEachRollingChargramHash('field', 3, 3, { maxTokenLength: null }, (g) => {
  fieldGram = g;
  return false;
});
const fieldChargrams = buildChargramsFromTokens(['field'], context);
if (!fieldChargrams.includes(fieldGram)) {
  console.error('chargram guardrail test failed: field chargrams missing.');
  process.exit(1);
}
let shortGram = null;
forEachRollingChargramHash('short', 3, 3, { maxTokenLength: null }, (g) => {
  shortGram = g;
  return false;
});
if (shortGram && fieldChargrams.includes(shortGram)) {
  console.error('chargram guardrail test failed: expected chargrams to use field tokens only.');
  process.exit(1);
}

console.log('chargram guardrail test passed');

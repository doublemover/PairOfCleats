#!/usr/bin/env node
import { buildChargramsFromTokens, createTokenizationContext, tokenizeChunkText } from '../src/index/build/tokenization.js';
import { tri } from '../src/shared/tokenize.js';

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

const longGram = tri('veryverylongtoken', 3)[0];
const chargrams = buildChargramsFromTokens(payload.tokens, context);
if (chargrams.includes(longGram)) {
  console.error('chargram guardrail test failed: long token chargrams should be skipped.');
  process.exit(1);
}

const fieldPayload = tokenizeChunkText({
  text: 'short',
  mode: 'code',
  ext: '.js',
  context
});
const fieldGram = tri('field', 3)[0];
const fieldChargrams = buildChargramsFromTokens(['field'], context);
if (!fieldChargrams.includes(fieldGram)) {
  console.error('chargram guardrail test failed: field chargrams missing.');
  process.exit(1);
}
if (fieldChargrams.includes(tri('short', 3)[0])) {
  console.error('chargram guardrail test failed: expected chargrams to use field tokens only.');
  process.exit(1);
}

console.log('chargram guardrail test passed');

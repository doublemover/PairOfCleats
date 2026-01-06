#!/usr/bin/env node
import {
  createTokenizationBuffers,
  createTokenizationContext,
  tokenizeChunkText
} from '../src/index/build/tokenization.js';

const context = createTokenizationContext({
  dictWords: new Set(['alpha', 'beta']),
  dictConfig: {},
  postingsConfig: {}
});

const input = {
  text: 'function alphaBeta() { return alpha + beta; }',
  mode: 'code',
  ext: '.js',
  context
};

const baseline = tokenizeChunkText(input);
const buffers = createTokenizationBuffers();
const buffered = tokenizeChunkText({ ...input, buffers });
const mutated = tokenizeChunkText({
  ...input,
  text: 'const gamma = alpha + beta;',
  buffers
});
const bufferedAgain = tokenizeChunkText({ ...input, buffers });

const compare = (label, a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`Tokenization mismatch for ${label}`);
    process.exit(1);
  }
};

compare('tokens', baseline.tokens, buffered.tokens);
compare('seq', baseline.seq, buffered.seq);
compare('ngrams', baseline.ngrams, buffered.ngrams);
compare('chargrams', baseline.chargrams, buffered.chargrams);
compare('minhash', baseline.minhashSig, buffered.minhashSig);
if (JSON.stringify(mutated.tokens) === JSON.stringify(baseline.tokens)) {
  console.error('Expected buffer reuse to handle different content.');
  process.exit(1);
}
compare('tokens (reuse)', baseline.tokens, bufferedAgain.tokens);
compare('minhash (reuse)', baseline.minhashSig, bufferedAgain.minhashSig);

console.log('tokenization buffering test passed');

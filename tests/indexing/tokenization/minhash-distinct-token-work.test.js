#!/usr/bin/env node
import assert from 'node:assert/strict';
import { tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { SimpleMinHash } from '../../../src/index/minhash.js';
import { hashTokenId } from '../../../src/shared/token-id.js';
for (const tokens of [[], ['__proto__', 'constructor', '2', '1', '😀', 'é', 'word', 'word', '__proto__'], Array(1000).fill('repeated')]) {
  const minhash = new SimpleMinHash(); let updates = 0;
  const update = minhash.update.bind(minhash); minhash.update = token => { updates += 1; update(token); };
  const actual = tokenizeChunkText({ text: '', mode: 'code', ext: '.js', context: {}, pretokenized: { tokens, seq: ['fixture'] }, buffers: { minhash } });
  const expected = new SimpleMinHash(); for (const token of tokens) expected.update(token);
  assert.deepEqual(actual.minhashSig, expected.hashValues);
  assert.deepEqual(actual.tokenIds, tokens.map(hashTokenId));
  assert.deepEqual(actual.tokens, tokens); assert.equal(updates, new Set(tokens).size);
  const frequencies = Object.create(null); for (const token of tokens) frequencies[token] = (frequencies[token] || 0) + 1;
  let entropy = 0; for (const count of Object.values(frequencies)) { const ratio = count / tokens.length; entropy -= ratio * Math.log2(ratio); }
  assert.deepEqual(actual.stats, { unique: Object.keys(frequencies).length, sum: tokens.length, entropy });
}

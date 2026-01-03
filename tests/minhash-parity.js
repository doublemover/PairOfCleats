#!/usr/bin/env node
import { SimpleMinHash } from '../src/indexer/minhash.js';
import { rankMinhash } from '../src/search/rankers.js';

const tokens = ['alpha', 'beta', 'gamma', 'delta'];
const mh = new SimpleMinHash();
tokens.forEach((token) => mh.update(token));
const idx = {
  minhash: { signatures: [mh.hashValues] },
  chunkMeta: [{ weight: 1 }]
};
const results = rankMinhash(idx, tokens, 1);
if (!results.length || results[0].idx !== 0) {
  console.error('minhash parity test failed: expected top hit for id 0');
  process.exit(1);
}
if (results[0].sim < 0.99) {
  console.error(`minhash parity test failed: expected sim≈1, got ${results[0].sim}`);
  process.exit(1);
}
console.log('minhash parity test passed');

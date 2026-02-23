#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendChunk, createIndexState } from '../../../src/index/build/state.js';

const postingsConfig = {
  typed: false,
  enablePhraseNgrams: false,
  enableChargrams: false,
  fielded: true
};

const state = createIndexState({ postingsConfig });

appendChunk(
  state,
  {
    file: 'src/alpha.js',
    tokens: ['alpha', 'alpha', 'beta'],
    seq: ['alpha', 'alpha', 'beta'],
    ngrams: ['alpha alpha'],
    fieldTokens: {
      name: ['alpha'],
      doc: ['beta'],
      body: ['alpha', 'alpha', 'beta']
    }
  },
  postingsConfig,
  { mode: 'none', sampleSize: 1 }
);

assert.equal(state.chunks.length, 1, 'expected chunk append');
assert.equal(state.chunks[0].tokenCount, 3, 'expected token count to use pre-retention payload');
assert.equal(state.docLengths[0], 3, 'expected doc length from full token stream');
assert.deepEqual(state.tokenPostings.get('alpha'), [[0, 2]], 'expected full-frequency alpha posting');
assert.deepEqual(state.tokenPostings.get('beta'), [[0, 1]], 'expected full-frequency beta posting');
assert.equal(state.fieldDocLengths.name[0], 1, 'expected field length to be indexed before retention');
assert.deepEqual(state.fieldTokens[0].name, ['alpha'], 'expected sampled field token retention to remain');
assert.deepEqual(state.fieldTokens[0].body, [], 'expected body alias retention trimming when classification is disabled');

assert.equal(state.chunks[0].tokens, undefined, 'expected chunk tokens removed in none mode');
assert.equal(state.chunks[0].seq, undefined, 'expected transient sequence payload removed');
assert.equal(state.chunks[0].fieldTokens, undefined, 'expected transient field tokens payload removed');
assert.equal(state.chunks[0].ngrams, undefined, 'expected transient ngrams payload removed');

console.log('token retention none preserves indexing stats test passed');

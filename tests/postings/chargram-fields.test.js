#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexState, appendChunk } from '../../src/index/build/state.js';
import { buildChargramsFromTokens } from '../../src/index/build/tokenization.js';
import { normalizePostingsConfig } from '../../src/shared/postings-config.js';

const postingsConfig = normalizePostingsConfig({
  enableChargrams: true,
  chargramSource: 'fields',
  chargramFields: ['signature', 'comment'],
  chargramMinN: 3,
  chargramMaxN: 3,
  chargramMaxTokenLength: 64,
  fielded: true
});

const state = createIndexState({ postingsConfig });
appendChunk(
  state,
  {
    file: 'src/example.js',
    lang: 'javascript',
    tokens: ['alpha'],
    seq: ['alpha'],
    fieldTokens: {
      name: ['namefield'],
      signature: ['signaturefield'],
      doc: ['docfield'],
      comment: ['commentfield'],
      body: ['bodyfield']
    }
  },
  postingsConfig
);

const observed = new Set(state.triPost.keys());
const expected = new Set(buildChargramsFromTokens(['signaturefield', 'commentfield'], postingsConfig));
const disallowed = new Set(buildChargramsFromTokens(['namefield', 'docfield', 'bodyfield'], postingsConfig));

for (const gram of expected) {
  assert.ok(observed.has(gram), `expected configured-field chargram missing: ${gram}`);
}
for (const gram of disallowed) {
  assert.ok(!observed.has(gram), `unexpected chargram from non-selected field: ${gram}`);
}

console.log('chargram fields test passed');

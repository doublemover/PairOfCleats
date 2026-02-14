#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexState, appendChunk } from '../../src/index/build/state.js';
import { buildChargramsFromTokens } from '../../src/index/build/tokenization.js';
import { normalizePostingsConfig } from '../../src/shared/postings-config.js';

const buildObservedSet = (chargramStopwords) => {
  const postingsConfig = normalizePostingsConfig({
    enableChargrams: true,
    chargramSource: 'fields',
    chargramFields: ['name'],
    chargramStopwords,
    chargramMinN: 3,
    chargramMaxN: 3,
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
        name: ['return', 'fetchdata'],
        signature: [],
        doc: [],
        comment: [],
        body: []
      }
    },
    postingsConfig
  );
  return { observed: new Set(state.triPost.keys()), postingsConfig };
};

const withoutStopwords = buildObservedSet(false);
const withStopwords = buildObservedSet(true);

const returnGrams = new Set(buildChargramsFromTokens(['return'], withoutStopwords.postingsConfig));
const fetchGrams = new Set(buildChargramsFromTokens(['fetchdata'], withoutStopwords.postingsConfig));

for (const gram of returnGrams) {
  assert.ok(withoutStopwords.observed.has(gram), 'expected return token chargram without stopword filtering');
  assert.ok(!withStopwords.observed.has(gram), 'expected return token chargram to be filtered when stopwords enabled');
}
for (const gram of fetchGrams) {
  assert.ok(withoutStopwords.observed.has(gram), 'expected fetchdata chargram without stopword filtering');
  assert.ok(withStopwords.observed.has(gram), 'expected non-stopword chargram to remain when stopwords enabled');
}

console.log('chargram stopwords test passed');

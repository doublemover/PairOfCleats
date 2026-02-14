#!/usr/bin/env node
import assert from 'node:assert/strict';
import { computeRelationBoost } from '../../src/retrieval/scoring/relation-boost.js';

const chunk = {
  lang: 'javascript',
  file: 'src/example.js',
  codeRelations: {
    usages: ['if', 'return']
  }
};

const stopwordsEnabled = computeRelationBoost({
  chunk,
  queryTokens: ['if', 'return'],
  config: {
    enabled: true,
    lexiconEnabled: true,
    perCall: 0.25,
    perUse: 0.1,
    maxBoost: 1.5
  }
});
const stopwordsDisabled = computeRelationBoost({
  chunk,
  queryTokens: ['if', 'return'],
  config: {
    enabled: true,
    lexiconEnabled: false,
    perCall: 0.25,
    perUse: 0.1,
    maxBoost: 1.5
  }
});
const caseSensitiveMixedCase = computeRelationBoost({
  chunk: {
    ...chunk,
    codeRelations: {
      usages: ['If', 'return']
    }
  },
  queryTokens: ['If', 'return'],
  config: {
    enabled: true,
    lexiconEnabled: true,
    caseTokens: true,
    perCall: 0.25,
    perUse: 0.1,
    maxBoost: 1.5
  }
});

assert.equal(stopwordsEnabled.queryTokenCount, 0, 'expected ranking stopwords to be removed');
assert.equal(stopwordsEnabled.usageMatches, 0, 'expected no usage matches after stopword elision');
assert.equal(stopwordsEnabled.boost, 0, 'expected zero boost after stopword elision');
assert.equal(stopwordsDisabled.usageMatches, 2, 'expected usage matches when stopword filtering is disabled');
assert.equal(stopwordsDisabled.boost, 0.2, 'unexpected boost without stopword filtering');
assert.equal(
  caseSensitiveMixedCase.queryTokenCount,
  1,
  'expected mixed-case token to survive stopword filtering when caseTokens=true'
);
assert.equal(
  caseSensitiveMixedCase.usageMatches,
  1,
  'expected case-sensitive mixed-case token to contribute relation usage match'
);
assert.equal(caseSensitiveMixedCase.boost, 0.1, 'unexpected case-sensitive mixed-case boost');

console.log('relation boost stopword elision test passed');

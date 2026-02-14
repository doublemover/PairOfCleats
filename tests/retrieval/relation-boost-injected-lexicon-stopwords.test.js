#!/usr/bin/env node
import assert from 'node:assert/strict';
import { computeRelationBoost } from '../../src/retrieval/scoring/relation-boost.js';

const chunk = {
  lang: 'javascript',
  file: 'src/example.js',
  codeRelations: {
    usages: ['customstop', 'signal']
  }
};

const injectedLexicon = {
  getLanguageLexicon() {
    return {
      languageId: 'javascript',
      stopwords: {
        ranking: new Set(['customstop'])
      },
      keywords: new Set(['customstop']),
      literals: new Set(),
      types: new Set(),
      builtins: new Set()
    };
  }
};

const result = computeRelationBoost({
  chunk,
  queryTokens: ['customstop', 'signal'],
  lexicon: injectedLexicon,
  config: {
    enabled: true,
    lexiconEnabled: true,
    perCall: 0.25,
    perUse: 0.1,
    maxBoost: 1.5
  }
});

assert.equal(result.queryTokenCount, 1, 'injected lexicon ranking stopword should be elided');
assert.equal(result.usageMatches, 1, 'only non-stopword token should match');
assert.equal(result.boost, 0.1, 'unexpected boost when injected stopwords are respected');
assert.deepEqual(result.signalTokens, ['signal'], 'signal tokens should exclude injected stopwords');
assert.deepEqual(result.matchedUsages, ['signal'], 'matched usage tokens should exclude injected stopwords');

console.log('relation boost injected lexicon stopword test passed');

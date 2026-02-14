#!/usr/bin/env node
import assert from 'node:assert/strict';
import { computeRelationBoost } from '../../src/retrieval/scoring/relation-boost.js';

const chunk = {
  lang: 'javascript',
  file: 'src/example.js',
  codeRelations: {
    calls: [
      ['run', 'fetchData'],
      ['run', 'render']
    ],
    usages: ['result', 'options', 'fetchData']
  }
};

const result = computeRelationBoost({
  chunk,
  queryTokens: ['fetchdata', 'result', 'if'],
  config: {
    enabled: true,
    perCall: 0.25,
    perUse: 0.1,
    maxBoost: 1.5,
    caseTokens: false
  }
});

assert.equal(result.callMatches, 1, 'expected one call relation match');
assert.equal(result.usageMatches, 2, 'expected two usage relation matches');
assert.equal(result.rawBoost, 0.45, 'unexpected raw relation boost');
assert.equal(result.boost, 0.45, 'unexpected bounded relation boost');
assert.deepEqual(result.matchedCalls, ['fetchdata'], 'unexpected matched call tokens');
assert.deepEqual(result.matchedUsages, ['fetchdata', 'result'], 'unexpected matched usage tokens');
assert.ok(!result.signalTokens.includes('if'), 'expected ranking stopword token to be elided');

console.log('relation boost scoring test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { compileFtsMatchQuery, escapeFtsLiteral, normalizeFtsLiteral } from '../../../src/retrieval/fts-query.js';

assert.equal(normalizeFtsLiteral('  alpha\n beta  '), 'alpha beta', 'expected normalized whitespace');
assert.equal(escapeFtsLiteral('a"b'), 'a""b', 'expected quote escaping');

const injection = compileFtsMatchQuery({
  queryAst: { type: 'term', value: 'foo" OR bar' },
  queryTokens: [],
  query: 'foo" OR bar'
});
assert.equal(injection.match, '"foo"" OR bar"', 'expected operator payload to stay quoted');

const keywordLiteral = compileFtsMatchQuery({
  queryAst: {
    type: 'and',
    left: { type: 'term', value: 'alpha' },
    right: { type: 'term', value: 'OR' }
  },
  queryTokens: ['alpha', 'or'],
  query: 'alpha OR'
});
assert.ok(keywordLiteral.match.includes('"OR"'), 'expected keyword literal to be escaped as a term');
assert.ok(!/\sOR\s(?!\()/.test(keywordLiteral.match), 'expected no unescaped OR operator in compiled literal branch');

const punctuation = compileFtsMatchQuery({
  queryAst: { type: 'phrase', value: 'C++ vector<T>' },
  queryTokens: [],
  query: '"C++ vector<T>"'
});
assert.equal(punctuation.match, '"C++ vector<T>"', 'expected punctuation to remain literal in quotes');

const fallback = compileFtsMatchQuery({
  queryAst: null,
  queryTokens: ['alpha', 'alpha', 'beta'],
  query: 'alpha beta'
});
assert.equal(fallback.match, '"alpha" AND "beta"', 'expected deterministic token fallback with dedupe');

console.log('sqlite fts query escape test passed');

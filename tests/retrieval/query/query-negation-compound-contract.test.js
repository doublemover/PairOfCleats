#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseQueryInput } from '../../../src/retrieval/query.js';

const simple = parseQueryInput('NOT alpha');
assert.deepEqual(simple.excludeTerms, ['alpha'], 'expected direct NOT term to populate excludes');

const compoundAnd = parseQueryInput('NOT (alpha AND beta)');
assert.deepEqual(
  compoundAnd.excludeTerms,
  [],
  'expected compound negation to avoid flattening into term excludes'
);

const compoundOr = parseQueryInput('NOT (alpha OR "beta gamma")');
assert.deepEqual(
  compoundOr.excludeTerms,
  [],
  'expected OR negation to avoid flattening into term excludes'
);
assert.deepEqual(
  compoundOr.excludePhrases,
  [],
  'expected OR negation to avoid flattening into phrase excludes'
);

console.log('query negation compound contract test passed');

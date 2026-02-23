#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseQueryInput, parseQueryWithFallback } from '../../../src/retrieval/query.js';

const simple = parseQueryInput('NOT alpha');
assert.deepEqual(simple.excludeTerms, ['alpha'], 'expected direct NOT term to populate excludes');

assert.throws(
  () => parseQueryInput('NOT (alpha AND beta)'),
  /Compound negation is not supported/i,
  'expected compound AND negation to be rejected explicitly'
);

assert.throws(
  () => parseQueryInput('NOT (alpha OR "beta gamma")'),
  /Compound negation is not supported/i,
  'expected compound OR negation to be rejected explicitly'
);

assert.throws(
  () => parseQueryWithFallback('NOT (alpha AND beta)'),
  /Compound negation is not supported/i,
  'expected fallback parser path to treat compound negation as hard error'
);

console.log('query negation compound contract test passed');

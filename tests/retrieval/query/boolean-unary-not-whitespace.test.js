#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseQueryInput } from '../../../src/retrieval/query.js';

const spacedUnary = parseQueryInput('- alpha');
assert.deepEqual(spacedUnary.excludeTerms, ['alpha'], 'expected spaced unary - to behave as NOT');

const tightUnary = parseQueryInput('-alpha');
assert.deepEqual(tightUnary.excludeTerms, ['alpha'], 'expected tight unary - to behave as NOT');

const mixed = parseQueryInput('alpha - beta');
assert.deepEqual(mixed.includeTerms, ['alpha'], 'expected positive include term to remain');
assert.deepEqual(mixed.excludeTerms, ['beta'], 'expected spaced unary - term to populate excludes');

assert.throws(
  () => parseQueryInput('-'),
  /Standalone "-" is not allowed/i,
  'expected standalone - to produce parse error'
);

console.log('boolean unary not whitespace test passed');

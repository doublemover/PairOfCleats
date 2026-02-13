#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseQueryInput } from '../../../src/retrieval/query.js';

const inventoryLiteral = parseQueryInput('tokens:[alpha,beta,gamma]');
assert.deepEqual(
  inventoryLiteral.includeTerms,
  ['tokens:[alpha,beta,gamma]'],
  'expected inventory-like list to remain a literal term'
);
assert.deepEqual(inventoryLiteral.excludeTerms, [], 'expected no implicit semantic excludes');
assert.equal(inventoryLiteral.ast?.type, 'term', 'expected literal term AST node');

const inventoryAndKeyword = parseQueryInput('tokens:[alpha,beta] OR gamma');
assert.equal(inventoryAndKeyword.ast?.type, 'or', 'expected explicit OR to remain semantic operator');
assert.deepEqual(
  inventoryAndKeyword.includeTerms,
  ['tokens:[alpha,beta]', 'gamma'],
  'expected inventory token list to remain literal term alongside semantic OR branch'
);

console.log('boolean inventory vs semantics test passed');

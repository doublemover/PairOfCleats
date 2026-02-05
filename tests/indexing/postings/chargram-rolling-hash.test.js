#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildChargramsFromTokens } from '../../../src/index/build/tokenization.js';
import { createIndexState, appendChunk } from '../../../src/index/build/state.js';

const options = { chargramMinN: 3, chargramMaxN: 3, chargramMaxTokenLength: 16 };
const grams1 = buildChargramsFromTokens(['alpha'], options);
const grams2 = buildChargramsFromTokens(['alpha'], options);

assert.deepEqual(grams1, grams2, 'rolling hash chargrams should be deterministic');
assert.ok(grams1.length > 0, 'expected chargrams for token');
assert.ok(grams1.every((g) => typeof g === 'string' && g.startsWith('h64:')), 'expected hashed chargram prefix');

const state = createIndexState();
appendChunk(state, { tokens: ['alpha'], seq: ['alpha'], file: 'alpha.txt' }, options);
const firstKey = Array.from(state.triPost.keys())[0];
assert.ok(typeof firstKey === 'string' && firstKey.startsWith('h64:'), 'expected hashed chargrams in postings map');

console.log('chargram rolling hash test passed');

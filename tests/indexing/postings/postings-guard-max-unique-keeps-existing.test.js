#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexState, appendChunk } from '../../../src/index/build/state.js';

const state = createIndexState();
state.postingsGuard.chargram.maxUnique = 1;

appendChunk(state, {
  tokens: ['a'],
  seq: ['a'],
  chargrams: ['aaa'],
  file: 'one.txt'
}, { enableChargrams: true, chargramMinN: 3, chargramMaxN: 3 });

appendChunk(state, {
  tokens: ['b'],
  seq: ['b'],
  chargrams: ['aaa', 'bbb'],
  file: 'two.txt'
}, { enableChargrams: true, chargramMinN: 3, chargramMaxN: 3 });

assert.equal(state.triPost.size, 1, 'expected maxUnique to block new keys');
const postings = state.triPost.get('aaa');
assert.ok(Array.isArray(postings), 'expected postings list array');
assert.deepEqual(postings, [0, 1], 'expected existing key to accept new doc id');

console.log('postings max unique guard test passed');

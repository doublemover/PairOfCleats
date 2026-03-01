#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexState, appendChunk } from '../../../src/index/build/state.js';
import { forEachRollingChargramHash } from '../../../src/shared/chargram-hash.js';

const firstChargramHash = (token, minN, maxN) => {
  let first = null;
  forEachRollingChargramHash(token, minN, maxN, {}, (hash) => {
    first = hash;
    return false;
  });
  return first;
};

const state = createIndexState();
state.postingsGuard.chargram.maxUnique = 1;

const keepKey = firstChargramHash('aaa', 3, 3);
assert.ok(keepKey && keepKey.startsWith('h64:'), 'expected hashed chargram key');

appendChunk(state, {
  tokens: ['aaa'],
  seq: ['aaa'],
  file: 'one.txt'
}, { enableChargrams: true, chargramMinN: 3, chargramMaxN: 3 });

appendChunk(state, {
  tokens: ['aaa', 'bbb'],
  seq: ['aaa', 'bbb'],
  file: 'two.txt'
}, { enableChargrams: true, chargramMinN: 3, chargramMaxN: 3 });

assert.equal(state.triPost.size, 1, 'expected maxUnique to block new keys');
const postings = state.triPost.get(keepKey);
assert.ok(Array.isArray(postings), 'expected postings list array');
assert.deepEqual(postings, [0, 1], 'expected existing key to accept new doc id');

console.log('postings max unique guard test passed');

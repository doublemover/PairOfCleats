#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexState, appendChunk } from '../../../src/index/build/state.js';
import { forEachRollingChargramHash } from '../../../src/shared/chargram-hash.js';

const state = createIndexState();
const postingsConfig = {
  enableChargrams: true,
  chargramMinN: 3,
  chargramMaxN: 3,
  chargramMaxTokenLength: 5
};

appendChunk(state, {
  tokens: ['thisislong', 'ok'],
  seq: ['thisislong', 'ok'],
  file: 'sample.txt'
}, postingsConfig);

let expected = null;
forEachRollingChargramHash('ok', 3, 3, { maxTokenLength: null }, (g) => {
  expected = g;
  return false;
});
const postings = state.triPost.get(expected);
assert.ok(postings !== undefined, 'expected chargram from short token');

console.log('postings chargram long token test passed');

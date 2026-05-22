#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createOrderingHasher } from '../../../src/shared/order.js';
import { buildPostingsFromTokens } from './helpers/build-postings-fixture.js';

const buildVocab = async (tokens) => {
  const postings = await buildPostingsFromTokens({ tokens });
  return postings.tokenVocab;
};

const vocabA = await buildVocab(['delta', 'alpha', 'beta']);
const vocabB = await buildVocab(['beta', 'delta', 'alpha']);

assert.deepEqual(vocabA, vocabB, 'token vocab ordering should be deterministic');

const hashVocab = (vocab) => {
  const hasher = createOrderingHasher();
  for (const entry of vocab) hasher.update(entry);
  return hasher.digest().hash;
};

assert.equal(hashVocab(vocabA), hashVocab(vocabB), 'vocab ordering hash should match');

console.log('vocab order determinism test passed');

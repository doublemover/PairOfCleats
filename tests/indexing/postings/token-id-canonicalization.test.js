#!/usr/bin/env node
import assert from 'node:assert/strict';
import { hashTokenId } from '../../../src/shared/token-id.js';
import { buildPostingsFromTokens } from './helpers/build-postings-fixture.js';

const tokens = ['delta', 'alpha', 'beta', 'alpha'];
const tokenIds = tokens.map((token) => hashTokenId(token));

const postings = await buildPostingsFromTokens({ tokens, tokenIds });

assert.equal(postings.tokenVocab.length, postings.tokenVocabIds.length, 'token vocab ids length mismatch');
for (let i = 0; i < postings.tokenVocab.length; i += 1) {
  const token = postings.tokenVocab[i];
  assert.equal(postings.tokenVocabIds[i], hashTokenId(token), `token id mismatch for ${token}`);
}

console.log('token id canonicalization test passed');

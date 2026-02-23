#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPostings } from '../../../src/index/build/postings.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'postings-spill-merge');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const phrasePost = new Map();
for (let i = 0; i < 6001; i += 1) {
  phrasePost.set(`token-${String(i).padStart(4, '0')}`, [i % 5]);
}

const phraseCount = phrasePost.size;

const result = await buildPostings({
  chunks: [{ tokenCount: 1, tokens: ['alpha'] }],
  df: new Map(),
  tokenPostings: new Map([['alpha', [[0, 1]]]]),
  docLengths: [1],
  fieldPostings: null,
  fieldDocLengths: null,
  phrasePost,
  triPost: null,
  postingsConfig: {
    enablePhraseNgrams: true,
    enableChargrams: false,
    phraseSpillMaxBytes: 1
  },
  buildRoot: tempRoot,
  embeddingsEnabled: false,
  log: () => {}
});

assert.equal(result.phraseVocab.length, phraseCount);
assert.equal(result.phrasePostings.length, phraseCount);
assert.equal(result.phraseVocab[0], 'token-0000');
assert.equal(result.phraseVocab[result.phraseVocab.length - 1], 'token-6000');

const leftovers = await fs.readdir(tempRoot);
assert.ok(!leftovers.some((name) => name.includes('phrase_postings.runs')), 'spill runs should be cleaned');
assert.ok(!leftovers.some((name) => name.includes('phrase_postings.merge')), 'merge dir should be cleaned');

console.log('spill merge unified test passed');

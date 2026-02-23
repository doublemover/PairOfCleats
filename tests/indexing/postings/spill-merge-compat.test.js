#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPostings } from '../../../src/index/build/postings.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'postings-spill-compat');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const phrasePost = new Map();
for (let i = 0; i < 6001; i += 1) {
  phrasePost.set(`token-${String(i).padStart(4, '0')}`, [i % 5]);
}

const buildInput = (overrides = {}) => ({
  chunks: [{ tokenCount: 1, tokens: ['alpha'] }],
  df: new Map(),
  tokenPostings: new Map([['alpha', [[0, 1]]]]),
  docLengths: [1],
  fieldPostings: null,
  fieldDocLengths: null,
  phrasePost: new Map(phrasePost),
  triPost: null,
  postingsConfig: {
    enablePhraseNgrams: true,
    enableChargrams: false,
    phraseSpillMaxBytes: 0
  },
  embeddingsEnabled: false,
  log: () => {},
  ...overrides
});

const baseline = await buildPostings(buildInput());
const spilled = await buildPostings(buildInput({
  buildRoot: tempRoot,
  postingsConfig: {
    enablePhraseNgrams: true,
    enableChargrams: false,
    phraseSpillMaxBytes: 1
  }
}));

assert.deepEqual(spilled.phraseVocab, baseline.phraseVocab, 'spill output vocab should match baseline');
assert.deepEqual(spilled.phrasePostings, baseline.phrasePostings, 'spill output postings should match baseline');

console.log('spill merge compat test passed');

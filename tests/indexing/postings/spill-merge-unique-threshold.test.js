#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPostings } from '../../../src/index/build/postings.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'postings-spill-unique-threshold');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const phrasePost = new Map();
for (let i = 0; i < 6001; i += 1) {
  phrasePost.set(`token-${String(i).padStart(4, '0')}`, [i % 7]);
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
    phraseSpillMaxBytes: 0,
    phraseSpillMaxUnique: 0
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
    phraseSpillMaxBytes: 0,
    phraseSpillMaxUnique: 1
  }
}));

assert.deepEqual(spilled.phraseVocab, baseline.phraseVocab, 'spill-by-unique vocab should match baseline');
assert.deepEqual(spilled.phrasePostings, baseline.phrasePostings, 'spill-by-unique postings should match baseline');
assert.ok((spilled.postingsMergeStats?.phrase?.runs || 0) >= 1, 'expected spill-by-unique merge runs');

const leftovers = await fs.readdir(tempRoot);
assert.ok(!leftovers.some((name) => name.includes('phrase_postings.runs')), 'spill runs should be cleaned');
assert.ok(!leftovers.some((name) => name.includes('phrase_postings.merge')), 'merge dir should be cleaned');

console.log('spill merge unique threshold test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPostings } from '../../../src/index/build/postings.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import {
  createPhrasePost,
  createPhraseSpillInput
} from './helpers/build-postings-fixture.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'postings-spill-unique-threshold');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const phrasePost = createPhrasePost({ count: 6001, modulo: 7 });
const buildInput = ({ buildRoot = undefined, postingsConfig = {} } = {}) => createPhraseSpillInput({
  phrasePost,
  buildRoot,
  postingsConfig: {
    enablePhraseNgrams: true,
    enableChargrams: false,
    phraseSpillMaxBytes: 0,
    phraseSpillMaxUnique: 0,
    ...postingsConfig
  },
});

const baseline = await buildPostings(buildInput());
const spilled = await buildPostings(buildInput({
  buildRoot: tempRoot,
  postingsConfig: {
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

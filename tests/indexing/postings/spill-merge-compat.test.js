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
const tempRoot = resolveTestCachePath(root, 'postings-spill-compat');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const phrasePost = createPhrasePost({ count: 6001, modulo: 5 });
const buildInput = ({ buildRoot = undefined, postingsConfig = {} } = {}) => createPhraseSpillInput({
  phrasePost,
  buildRoot,
  postingsConfig: {
    enablePhraseNgrams: true,
    enableChargrams: false,
    phraseSpillMaxBytes: 0,
    ...postingsConfig
  },
});

const baseline = await buildPostings(buildInput());
const spilled = await buildPostings(buildInput({
  buildRoot: tempRoot,
  postingsConfig: {
    phraseSpillMaxBytes: 1
  }
}));

assert.deepEqual(spilled.phraseVocab, baseline.phraseVocab, 'spill output vocab should match baseline');
assert.deepEqual(spilled.phrasePostings, baseline.phrasePostings, 'spill output postings should match baseline');

console.log('spill merge compat test passed');

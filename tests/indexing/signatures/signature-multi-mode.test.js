#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyAdaptiveDictConfig } from '../../../tools/shared/dict-utils.js';
import { buildTokenizationKey } from '../../../src/index/build/indexer/signatures.js';

const dictConfig = {
  segmentation: 'auto',
  dpMaxTokenLength: 16,
  dpMaxTokenLengthByFileCount: [
    { maxFiles: 1, dpMaxTokenLength: 12 },
    { maxFiles: 500, dpMaxTokenLength: 8 }
  ]
};

const runtime = {
  dictConfig,
  postingsConfig: {},
  segmentsConfig: {},
  commentsConfig: {},
  dictSignature: 'test-signature'
};

const proseBefore = buildTokenizationKey(runtime, 'prose');
const codeDict = applyAdaptiveDictConfig(runtime.dictConfig, 500);
const codeRuntime = { ...runtime, dictConfig: codeDict };
buildTokenizationKey(codeRuntime, 'code');
const proseAfter = buildTokenizationKey(runtime, 'prose');

assert.equal(proseAfter, proseBefore, 'prose signature should not change after code run');
assert.equal(runtime.dictConfig.dpMaxTokenLength, 16, 'runtime dictConfig should not be mutated');

console.log('signature multi-mode test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildTokenSequence } from '../../../src/index/build/tokenization.js';

const dictWords = new Set(['request', 'builder']);
const dictConfig = {};

const htmlTokens = buildTokenSequence({
  text: 'requestbuilder',
  mode: 'prose',
  ext: '.html',
  dictWords,
  dictConfig
}).tokens;

const txtTokens = buildTokenSequence({
  text: 'requestbuilder',
  mode: 'prose',
  ext: '.txt',
  dictWords,
  dictConfig
}).tokens;

assert.equal(
  htmlTokens.includes('request') || htmlTokens.includes('builder'),
  false,
  'expected prose html tokenization to bypass dictionary segmentation'
);

assert.equal(
  txtTokens.includes('request') && txtTokens.includes('builder'),
  true,
  'expected prose plain-text tokenization to keep dictionary segmentation'
);

console.log('prose dict segmentation bypass test passed');


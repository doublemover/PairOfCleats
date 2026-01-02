#!/usr/bin/env node
import { splitWordsWithDict } from '../src/shared/tokenize.js';

const dict = new Set(['alpha', 'beta']);
const unknown = splitWordsWithDict('alphazzzbeta', dict, { segmentation: 'greedy' });
if (unknown.join('|') !== 'alpha|zzz|beta') {
  console.error(`Unexpected unknown span split: ${unknown.join('|')}`);
  process.exit(1);
}

const dpDict = new Set(['abc', 'ab', 'cd']);
const autoSegments = splitWordsWithDict('abcd', dpDict, { segmentation: 'auto', dpMaxTokenLength: 8 });
if (autoSegments.join('|') !== 'ab|cd') {
  console.error(`Unexpected DP fallback split: ${autoSegments.join('|')}`);
  process.exit(1);
}

console.log('dictionary tokenization test passed');

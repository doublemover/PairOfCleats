#!/usr/bin/env node
import { applyAdaptiveDictConfig } from '../../../tools/shared/dict-utils.js';

const base = {
  segmentation: 'auto',
  dpMaxTokenLength: 32,
  dpMaxTokenLengthByFileCount: [
    { maxFiles: 5000, dpMaxTokenLength: 32 },
    { maxFiles: 20000, dpMaxTokenLength: 24 },
    { maxFiles: 999999, dpMaxTokenLength: 16 }
  ]
};

const expect = (actual, expected, label) => {
  if (actual !== expected) {
    console.error(`dict adaptive test failed (${label}): expected ${expected}, got ${actual}`);
    process.exit(1);
  }
};

expect(applyAdaptiveDictConfig(base, 100).dpMaxTokenLength, 32, 'small repo');
expect(applyAdaptiveDictConfig(base, 12000).dpMaxTokenLength, 24, 'mid repo');
expect(applyAdaptiveDictConfig(base, 80000).dpMaxTokenLength, 16, 'large repo');
expect(applyAdaptiveDictConfig({ segmentation: 'greedy', dpMaxTokenLength: 12 }, 50000).dpMaxTokenLength, 12, 'greedy override');

console.log('dictionary adaptive config test passed');

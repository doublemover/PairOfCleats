#!/usr/bin/env node
import { normalizeEmbeddingBatchMultipliers, resolveEmbeddingBatchSize } from '../src/index/build/embedding-batch.js';

const multipliers = normalizeEmbeddingBatchMultipliers({ typescript: 4, python: 2 }, { typescript: 3, rust: 1.5 });

const expect = (label, actual, expected) => {
  if (actual !== expected) {
    console.error(`embedding batch multiplier failed (${label}): ${actual} !== ${expected}`);
    process.exit(1);
  }
};

expect('typescript', resolveEmbeddingBatchSize(10, 'typescript', multipliers), 40);
expect('python', resolveEmbeddingBatchSize(10, 'python', multipliers), 20);
expect('rust fallback', resolveEmbeddingBatchSize(10, 'rust', multipliers), 15);
expect('unknown', resolveEmbeddingBatchSize(10, 'go', multipliers), 10);

console.log('embedding batch multiplier test passed');

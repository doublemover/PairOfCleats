#!/usr/bin/env node
import { resolveAutoEmbeddingBatchSize } from '../src/shared/embedding-batch.js';

const oneGb = 1024 ** 3;

const small = resolveAutoEmbeddingBatchSize(oneGb);
if (small !== 16) {
  console.error(`embedding batch defaults test failed: expected 16 for 1GB, got ${small}`);
  process.exit(1);
}

const mid = resolveAutoEmbeddingBatchSize(2 * oneGb);
if (mid !== 32) {
  console.error(`embedding batch defaults test failed: expected 32 for 2GB, got ${mid}`);
  process.exit(1);
}

const large = resolveAutoEmbeddingBatchSize(16 * oneGb);
if (large !== 128) {
  console.error(`embedding batch defaults test failed: expected 128 for 16GB, got ${large}`);
  process.exit(1);
}

console.log('embedding batch defaults test passed');

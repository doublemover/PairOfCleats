#!/usr/bin/env node
import { resolveThreadLimits } from '../../../src/shared/threads.js';

const threadLimits = resolveThreadLimits({
  configConcurrency: 8,
  importConcurrencyConfig: 8,
  ioConcurrencyCapConfig: 16
});

if (threadLimits.ioConcurrency !== 16) {
  throw new Error(`io-concurrency-cap test failed: expected ioConcurrency=16, got ${threadLimits.ioConcurrency}`);
}

// Verify cap is not increasing concurrency
const uncapped = resolveThreadLimits({
  configConcurrency: 8,
  importConcurrencyConfig: 8
});
if (uncapped.ioConcurrency < threadLimits.ioConcurrency) {
  throw new Error(`io-concurrency-cap test failed: uncapped ioConcurrency=${uncapped.ioConcurrency} should be >= capped ioConcurrency=${threadLimits.ioConcurrency}`);
}

console.log('io-concurrency-cap test passed');

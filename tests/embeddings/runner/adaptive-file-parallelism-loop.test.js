#!/usr/bin/env node
import assert from 'node:assert/strict';

import { __runWithAdaptiveConcurrencyForTests } from '../../../tools/build/embeddings/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const items = Array.from({ length: 24 }, (_, i) => i + 1);
let processed = 0;

const result = await __runWithAdaptiveConcurrencyForTests({
  items,
  initialConcurrency: 4,
  resolveConcurrency: ({ active, remaining }) => {
    if (remaining <= 6) return 1;
    if (active >= 3) return 2;
    return 4;
  },
  worker: async () => {
    await wait(2);
    processed += 1;
  }
});

assert.equal(processed, items.length, 'expected all items to be processed');
assert.ok(result.peakConcurrency >= 2, 'expected adaptive runner to reach concurrent execution');
assert.ok(result.adjustments >= 1, 'expected adaptive runner to adjust concurrency at least once');
assert.ok(result.finalConcurrency >= 1, 'expected valid final concurrency');

console.log('adaptive file parallelism loop test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

const processed = [];
const logs = [];

const appender = buildOrderedAppender(
  async (result) => {
    processed.push(result.id);
  },
  {},
  {
    expectedCount: 2,
    startIndex: 0,
    bucketSize: 0,
    debugOrdered: true,
    log: (message) => logs.push(String(message || ''))
  }
);

await appender.enqueue(0, { id: 0 });
await appender.enqueue(1, { id: 1 });
await appender.enqueue(0, { id: 'late-0' });

assert.deepEqual(processed, [0, 1], 'stale result should not be appended once index advanced');
assert.ok(
  logs.some((message) => message.includes('dropping stale result index')),
  'expected stale-drop warning log'
);

console.log('ordered appender stale-drop test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

const runScenario = async ({ bucketSize }) => {
  const processed = [];
  const logs = [];
  const appender = buildOrderedAppender(
    async (result) => {
      processed.push(result.id);
    },
    {},
    {
      expectedCount: 6,
      startIndex: 0,
      bucketSize,
      debugOrdered: true,
      log: (message) => logs.push(String(message || ''))
    }
  );
  const tasks = [
    appender.enqueue(2, { id: 2 }),
    appender.enqueue(3, { id: 3 }),
    appender.enqueue(4, { id: 4 }),
    appender.enqueue(5, { id: 5 }),
    appender.enqueue(0, { id: 0 }),
    appender.enqueue(1, { id: 1 })
  ];
  await Promise.all(tasks);
  return { processed, logs };
};

const bucketed = await runScenario({ bucketSize: 2 });
assert.deepEqual(bucketed.processed, [0, 1, 2, 3, 4, 5], 'expected deterministic flush order with bucketing');
assert.ok(
  bucketed.logs.some((message) => message.includes('bucket watermark yield')),
  'expected bucket watermark yield log when bucket boundary is reached'
);

const unbucketed = await runScenario({ bucketSize: 0 });
assert.deepEqual(unbucketed.processed, [0, 1, 2, 3, 4, 5], 'expected deterministic flush order without bucketing');
assert.ok(
  !unbucketed.logs.some((message) => message.includes('bucket watermark yield')),
  'did not expect bucket watermark logs when bucketing is disabled'
);

console.log('ordered appender bucketed watermark test passed');

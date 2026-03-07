#!/usr/bin/env node
import assert from 'node:assert/strict';
import PQueue from 'p-queue';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { runWithQueue } from '../../../src/shared/concurrency.js';

ensureTestingEnv(process.env);

const queue = new PQueue({ concurrency: 1 });
let stallEvents = 0;

await assert.rejects(
  () => runWithQueue(
    queue,
    [1, 2],
    async (item) => item,
    {
      collectResults: false,
      pendingDrainTimeoutMs: 120,
      pendingDrainStallPollMs: 20,
      onPendingDrainStall: () => {
        stallEvents += 1;
      },
      onResult: async (_result, ctx) => {
        if (ctx.index === 0) {
          await new Promise(() => {});
        }
      }
    }
  ),
  (error) => error?.code === 'RUN_WITH_QUEUE_PENDING_DRAIN_TIMEOUT',
  'expected pending-drain timeout while one queue task never settles'
);

assert.ok(stallEvents >= 1, 'expected pending-drain stall callback to fire');

console.log('runWithQueue pending-drain timeout test passed');

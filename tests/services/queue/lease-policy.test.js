#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveLeaseWorkloadClass, resolveQueueLeasePolicy } from '../../../tools/service/lease-policy.js';

const balanced = resolveQueueLeasePolicy({
  job: { stage: 'stage1', mode: 'code' },
  queueName: 'index'
});
assert.equal(resolveLeaseWorkloadClass({ job: { stage: 'stage1' }, queueName: 'index' }), 'balanced');
assert.equal(balanced.workloadClass, 'balanced');
assert.equal(balanced.leaseMs, 5 * 60 * 1000);
assert.equal(balanced.renewIntervalMs, 30 * 1000);

const bursty = resolveQueueLeasePolicy({
  job: { stage: 'stage2', mode: 'both' },
  queueName: 'index-stage2'
});
assert.equal(resolveLeaseWorkloadClass({ job: { stage: 'stage2', mode: 'both' }, queueName: 'index-stage2' }), 'bursty');
assert.equal(bursty.workloadClass, 'bursty');
assert.equal(bursty.leaseMs, 10 * 60 * 1000);
assert.equal(bursty.renewIntervalMs, 20 * 1000);

const slow = resolveQueueLeasePolicy({
  job: { stage: 'stage3', reason: 'embeddings' },
  queueName: 'embeddings'
});
assert.equal(resolveLeaseWorkloadClass({ job: { stage: 'stage3', reason: 'embeddings' }, queueName: 'embeddings' }), 'slow');
assert.equal(slow.workloadClass, 'slow');
assert.equal(slow.leaseMs, 15 * 60 * 1000);
assert.equal(slow.renewIntervalMs, 60 * 1000);
assert.equal(slow.renewIntervalMs < slow.leaseMs, true, 'expected renew interval to stay below lease');
assert.equal(slow.progressIntervalMs <= slow.leaseMs, true, 'expected bounded progress interval');

console.log('service queue lease policy test passed');

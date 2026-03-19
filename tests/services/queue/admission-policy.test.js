#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  evaluateQueueBackpressure,
  resolveEnqueueBackpressure,
  resolveQueueAdmissionPolicy
} from '../../../tools/service/admission-policy.js';

const policy = resolveQueueAdmissionPolicy({
  queueName: 'index',
  queueConfig: {
    maxQueued: 2,
    maxRunning: 1,
    maxTotal: 2,
    resourceBudgetUnits: 10
  },
  workerConfig: {
    concurrency: 1
  }
});

const jobs = [
  { id: 'job-a', status: 'running', queueName: 'index', stage: 'stage2', mode: 'code' },
  { id: 'job-b', status: 'queued', queueName: 'index', stage: 'stage1', mode: 'code' }
];

const backpressure = evaluateQueueBackpressure({
  jobs,
  queueName: 'index',
  policy
});
assert.equal(backpressure.state, 'saturated', 'expected total active saturation to surface as saturated');
assert.equal(backpressure.reasons.includes('max_running'), true, 'expected running saturation reason');
assert.equal(backpressure.reasons.includes('max_total'), true, 'expected total saturation reason');
assert.equal(backpressure.reasons.includes('resource_budget'), false, 'expected room to remain in the resource budget');

const block = resolveEnqueueBackpressure({
  jobs,
  job: { id: 'job-c', queueName: 'index', stage: 'stage3', mode: 'both' },
  queueName: 'index',
  policy
});
assert.equal(block?.code, 'QUEUE_BACKPRESSURE_MAX_TOTAL', 'expected projected active limit to reject the enqueue');
assert.equal(block?.reason, 'max_total', 'expected explicit rejection reason code');

const embeddingsPolicy = resolveQueueAdmissionPolicy({
  queueName: 'embeddings-stage3',
  queueConfig: {
    maxQueued: 3
  },
  workerConfig: {
    concurrency: 2
  }
});
assert.equal(embeddingsPolicy.queueClass, 'embeddings', 'expected embeddings-* queues to retain embeddings policy class');
assert.equal(embeddingsPolicy.maxTotal, 5, 'expected embeddings queue defaults to diverge from index totals');

console.log('service queue admission policy test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  evaluateQueueBackpressure,
  resolveEnqueueBackpressure,
  resolveQueueAdmissionPolicy,
  resolveQueueSloPolicy
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

const sloPolicy = resolveQueueSloPolicy({
  queueName: 'index',
  queueConfig: {
    slo: {
      maxQueueAgeMs: {
        degraded: 1000,
        overloaded: 5000
      },
      maxRunLatencyMs: {
        degraded: 1000,
        overloaded: 5000
      },
      maxRetryRate: {
        degraded: 0.25,
        overloaded: 0.5
      },
      maxSaturationRatio: {
        degraded: 0.5,
        overloaded: 0.9
      },
      deferDelayMs: {
        degraded: 2000,
        overloaded: 7000
      }
    }
  }
});
const nowMs = Date.parse('2026-03-18T12:00:10.000Z');
const degradedJobs = [
  {
    id: 'job-degraded',
    status: 'queued',
    queueName: 'index',
    stage: 'stage1',
    createdAt: '2026-03-18T12:00:08.000Z',
    attempts: 0
  }
];
const degradedBackpressure = evaluateQueueBackpressure({
  jobs: degradedJobs,
  queueName: 'index',
  policy,
  sloPolicy,
  nowMs
});
assert.equal(degradedBackpressure.slo.state, 'degraded', 'expected aged queue to enter degraded SLO state');
assert.equal(degradedBackpressure.slo.actions.workerMode, 'priority-only', 'expected degraded queues to advertise priority-only mode');

const deferredHeavy = resolveEnqueueBackpressure({
  jobs: degradedJobs,
  job: { id: 'job-heavy', queueName: 'index', stage: 'stage3', mode: 'both' },
  queueName: 'index',
  policy,
  sloPolicy,
  nowMs
});
assert.equal(deferredHeavy?.action, 'defer', 'expected degraded heavy work to defer instead of silently enqueueing');
assert.equal(deferredHeavy?.delayMs, 2000, 'expected degraded defer window to follow SLO policy');
assert.equal(deferredHeavy?.jobTier, 'heavy', 'expected stage3 work to be classified as heavy');

const acceptedPriority = resolveEnqueueBackpressure({
  jobs: degradedJobs,
  job: { id: 'job-light', queueName: 'index', stage: 'stage1', mode: 'code' },
  queueName: 'index',
  policy,
  sloPolicy,
  nowMs
});
assert.equal(acceptedPriority?.action, 'accept', 'expected degraded priority work to remain admitted');

const overloadedJobs = [
  {
    id: 'job-overloaded-a',
    status: 'queued',
    queueName: 'index',
    stage: 'stage1',
    createdAt: '2026-03-18T11:59:55.000Z',
    attempts: 1
  },
  {
    id: 'job-overloaded-b',
    status: 'running',
    queueName: 'index',
    stage: 'stage2',
    createdAt: '2026-03-18T11:59:50.000Z',
    startedAt: '2026-03-18T11:59:50.000Z',
    attempts: 1
  }
];
const overloadedBackpressure = evaluateQueueBackpressure({
  jobs: overloadedJobs,
  queueName: 'index',
  policy: resolveQueueAdmissionPolicy({
    queueName: 'index',
    queueConfig: {
      maxQueued: 10,
      maxRunning: 10,
      maxTotal: 20,
      resourceBudgetUnits: 40
    },
    workerConfig: {
      concurrency: 2
    }
  }),
  sloPolicy,
  nowMs
});
assert.equal(overloadedBackpressure.slo.state, 'overloaded', 'expected old and retrying work to enter overloaded SLO state');

const rejectedHeavy = resolveEnqueueBackpressure({
  jobs: overloadedJobs,
  job: { id: 'job-heavy-reject', queueName: 'index', stage: 'stage3', mode: 'both' },
  queueName: 'index',
  policy: resolveQueueAdmissionPolicy({
    queueName: 'index',
    queueConfig: {
      maxQueued: 10,
      maxRunning: 10,
      maxTotal: 20,
      resourceBudgetUnits: 40
    },
    workerConfig: {
      concurrency: 2
    }
  }),
  sloPolicy,
  nowMs
});
assert.equal(rejectedHeavy?.action, 'reject', 'expected overloaded heavy work to be rejected');
assert.equal(rejectedHeavy?.code, 'QUEUE_SLO_OVERLOADED', 'expected overloaded rejection to use stable SLO code');

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
assert.equal(resolveQueueSloPolicy({ queueName: 'embeddings-stage3' }).queueClass, 'embeddings', 'expected embeddings queue SLO policy to retain class-specific defaults');

console.log('service queue admission policy test passed');

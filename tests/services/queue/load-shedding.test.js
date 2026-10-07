#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import {
  enqueueJob,
  loadQueue,
  saveQueue
} from '../../../tools/service/queue.js';
import {
  resolveQueueAdmissionPolicy,
  resolveQueueSloPolicy
} from '../../../tools/service/admission-policy.js';

const root = process.cwd();
const queueDir = resolveTestCachePath(root, 'service-queue-load-shedding');
await fs.rm(queueDir, { recursive: true, force: true });
await fs.mkdir(queueDir, { recursive: true });

const admissionPolicy = resolveQueueAdmissionPolicy({
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
});
const sloPolicy = resolveQueueSloPolicy({
  queueName: 'index',
  queueConfig: {
    slo: {
      maxQueueAgeMs: {
        degraded: 1000,
        overloaded: 3000
      },
      maxRunLatencyMs: {
        degraded: 1000,
        overloaded: 3000
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
        overloaded: 5000
      }
    }
  }
});

await saveQueue(queueDir, {
  jobs: [
    {
      id: 'existing-aged',
      status: 'queued',
      queueName: 'index',
      repo: '/tmp/existing',
      mode: 'code',
      stage: 'stage1',
      createdAt: new Date(Date.now() - 2000).toISOString(),
      attempts: 0
    }
  ]
}, 'index');

const deferred = await enqueueJob(queueDir, {
  id: 'job-heavy-deferred',
  createdAt: new Date().toISOString(),
  repo: '/tmp/heavy',
  mode: 'both',
  stage: 'stage3'
}, null, 'index', {
  admissionPolicy,
  sloPolicy
});
assert.equal(deferred.ok, true, 'expected heavy enqueue during degraded mode to succeed');
assert.equal(deferred.deferred, true, 'expected heavy enqueue to defer under degraded mode');
assert.equal(deferred.backpressure?.action, 'defer', 'expected enqueue response to expose defer action');
assert.equal(typeof deferred.backpressure?.deferredUntil, 'string', 'expected deferred enqueue to include next eligibility timestamp');

const deferredQueue = await loadQueue(queueDir, 'index');
const deferredJob = deferredQueue.jobs.find((entry) => entry.id === 'job-heavy-deferred');
assert.equal(typeof deferredJob?.nextEligibleAt, 'string', 'expected deferred job to persist delayed eligibility');
assert.equal(deferredJob?.progress?.kind, 'defer', 'expected deferred job to record defer progress kind');

await saveQueue(queueDir, {
  jobs: [
    {
      id: 'existing-overloaded-a',
      status: 'queued',
      queueName: 'index',
      repo: '/tmp/overloaded-a',
      mode: 'code',
      stage: 'stage1',
      createdAt: new Date(Date.now() - 10000).toISOString(),
      attempts: 1
    },
    {
      id: 'existing-overloaded-b',
      status: 'running',
      queueName: 'index',
      repo: '/tmp/overloaded-b',
      mode: 'both',
      stage: 'stage2',
      createdAt: new Date(Date.now() - 10000).toISOString(),
      startedAt: new Date(Date.now() - 10000).toISOString(),
      attempts: 1
    }
  ]
}, 'index');

const rejected = await enqueueJob(queueDir, {
  id: 'job-heavy-rejected',
  createdAt: new Date().toISOString(),
  repo: '/tmp/heavy-rejected',
  mode: 'both',
  stage: 'stage3'
}, null, 'index', {
  admissionPolicy,
  sloPolicy
});
assert.equal(rejected.ok, false, 'expected overloaded heavy enqueue to reject');
assert.equal(rejected.code, 'QUEUE_SLO_OVERLOADED', 'expected overloaded rejection code to remain stable');
assert.equal(rejected.backpressure?.action, 'reject', 'expected rejection payload to include action');

console.log('service queue load shedding test passed');

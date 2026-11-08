#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRunningQueueDuplicateLookup, queueJobsShareIdempotency, buildQueueJobIdempotencyKey } from '../../../tools/service/queue-idempotency.js';
const jobs = Array.from({ length: 256 }, (_, index) => ({ id: `job-${index}`, status: index % 5 ? 'queued' : 'running', idempotencyKey: `explicit-${index % 17}`, idempotencySource: 'explicit', nextEligibleAt: '2100-01-01' }));
const derived = { id: 'derived-running', status: 'running', repo: '/fixture', stage: 'stage2', idempotencySource: 'derived' };
derived.idempotencyKey = buildQueueJobIdempotencyKey(derived); jobs.push(derived);
const legacy = { ...derived, id: 'legacy-queued', status: 'queued', idempotencyKey: 'qjob1-' + 'a'.repeat(40), idempotencySource: 'legacy-derived' }; jobs.push(legacy);
const lookup = createRunningQueueDuplicateLookup(jobs);
for (const job of jobs) {
  const expected = jobs.find(candidate => candidate.status === 'running' && candidate.id !== job.id && candidate.idempotencyKey && queueJobsShareIdempotency(candidate, job)) || null;
  assert.equal(lookup(job), expected);
}
assert.equal(lookup(legacy), derived);

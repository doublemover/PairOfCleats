import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureQueueDir, enqueueJob, claimNextJob, loadQueue } from '../../../tools/service/queue.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('service-scoped-claim');
const queue = path.join(dir, 'queue'), selected = path.join(dir, 'selected'), other = path.join(dir, 'other');
await fs.mkdir(selected); await fs.mkdir(other); await ensureQueueDir(queue);
for (const [id, repo, reason] of [['first-other', other, 'foreign'], ['first-selected', selected, 'one'], ['second-selected', selected, 'two']]) {
  await enqueueJob(queue, { id, repo, mode: 'all', reason, createdAt: new Date().toISOString(),
    ...(id === 'second-selected' ? {} : { idempotencyKey: 'same-explicit-key' }) }, null, 'index', { forceDuplicate: true });
}
const before = (await loadQueue(queue, 'index')).jobs.find(job => job.id === 'first-other');
await assert.rejects(claimNextJob(queue, 'index', { admitJob: { executable: 'serialized' } }), TypeError);
const claimed = await claimNextJob(queue, 'index', { ownerId: 'native-owned', admitJob: job => job.repo === selected });
assert.equal(claimed.id, 'first-selected', 'eligible jobs retain their existing order');
assert.equal(claimed.lease.owner, 'native-owned');
assert.deepEqual((await loadQueue(queue, 'index')).jobs.find(job => job.id === 'first-other'), before,
  'foreign jobs retain status, duplicate metadata and lease fields even with the claimed explicit idempotency key');
const snapshot = await loadQueue(queue, 'index');
await assert.rejects(claimNextJob(queue, 'index', { admitJob: () => { throw new Error('scope changed'); } }), /scope changed/);
assert.deepEqual(await loadQueue(queue, 'index'), snapshot, 'a failed authority predicate publishes no claim or suppression');
await assert.rejects(claimNextJob(queue, 'index', { admitJob: async () => true }), /return a boolean/);
assert.deepEqual(await loadQueue(queue, 'index'), snapshot, 'async predicates cannot defer admission beyond the claim transaction');
console.log('Scoped queue claims preserve foreign jobs and existing eligible order under the claim lock');

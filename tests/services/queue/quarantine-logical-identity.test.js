import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { enqueueJob, quarantineJob, retryQuarantinedJob, claimNextJob, loadQueue, saveQueue,
  inspectJobReplayState, listDuplicateJobGroups } from '../../../tools/service/queue.js';
import { buildQueueJobIdempotencyKey, buildQueueJobIdempotencyPayload } from '../../../tools/service/queue-idempotency.js';
import { sha1 } from '../../../src/shared/hash.js';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir: root } = await prepareIsolatedTestCacheDir('quarantine-logical-identity');
const base = { repo: root, mode: 'code', stage: 'stage1', reason: 'manual' };
try {
  assert.deepEqual(buildQueueJobIdempotencyPayload(base), buildQueueJobIdempotencyPayload({ ...base, repoRoot: null, embeddingPayloadFormatVersion: null }));
  assert.equal(buildQueueJobIdempotencyKey(base), buildQueueJobIdempotencyKey({ ...base, repoRoot: root }));
  for (const variant of [{ embeddingPayloadFormatVersion: 1 }, { buildId: 'another' }, { embeddingPlan: { digest: 'another' } }]) {
    assert.notEqual(buildQueueJobIdempotencyKey(base), buildQueueJobIdempotencyKey({ ...base, ...variant }));
  }
  for (const freshFirst of [true, false]) {
    const queue = path.join(root, `order-${freshFirst}`);
    const original = await enqueueJob(queue, { ...base, id: 'original' });
    await quarantineJob(queue, 'original', 'controlled quarantine');
    let replay, fresh;
    if (freshFirst) {
      fresh = await enqueueJob(queue, { ...base, id: 'fresh' });
      replay = await retryQuarantinedJob(queue, 'original');
      assert.equal(replay.replaySuppressed, true);
      assert.equal(replay.job.id, fresh.job.id);
    } else {
      replay = await retryQuarantinedJob(queue, 'original');
      fresh = await enqueueJob(queue, { ...base, id: 'fresh' });
      assert.equal(fresh.duplicate, true);
      assert.equal(fresh.job.id, replay.job.id);
    }
    assert.equal(replay.idempotencyKey, original.idempotencyKey);
    assert.ok(await claimNextJob(queue));
    assert.equal(await claimNextJob(queue), null, 'only one logical job can be claimed');
  }
  const explicitQueue = path.join(root, 'explicit');
  await enqueueJob(explicitQueue, { ...base, id: 'explicit', idempotencyKey: 'caller-selected-identity' });
  await quarantineJob(explicitQueue, 'explicit', 'controlled quarantine');
  const explicit = await retryQuarantinedJob(explicitQueue, 'explicit');
  assert.equal(explicit.idempotencyKey, 'caller-selected-identity');
  assert.equal(explicit.job.idempotencySource, 'explicit');
  const legacyQueue = path.join(root, 'legacy');
  await enqueueJob(legacyQueue, { ...base, id: 'legacy' });
  const stored = await loadQueue(legacyQueue);
  const oldPayload = { ...buildQueueJobIdempotencyPayload(base), repoRoot: null };
  const retainedKey = `qjob1-${sha1(stableStringifyForSignature(oldPayload))}`;
  stored.jobs[0].idempotencyKey = retainedKey;
  delete stored.jobs[0].idempotencySource;
  await saveQueue(legacyQueue, stored);
  const duplicate = await enqueueJob(legacyQueue, { ...base, id: 'fresh' });
  assert.equal(duplicate.duplicate, true, 'existing persisted automatic identities participate in corrected duplicate suppression');
  assert.equal(duplicate.job.idempotencyKey, retainedKey, 'legacy receipt identity remains unchanged');
  await enqueueJob(legacyQueue, { ...base, id: 'forced' }, null, null, { forceDuplicate: true });
  assert.equal((await listDuplicateJobGroups(legacyQueue)).length, 1);
  assert.ok((await inspectJobReplayState(legacyQueue, 'legacy')).relatedJobs.some(job => job.id === 'forced'));
  assert.equal((await claimNextJob(legacyQueue)).id, 'legacy');
  assert.equal(await claimNextJob(legacyQueue), null, 'claim-side suppression agrees with replay inspection across key generations');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Quarantined retries preserve explicit/derived/legacy identity and deduplicate in either enqueue order.');

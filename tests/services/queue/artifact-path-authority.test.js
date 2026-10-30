import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { enqueueJob, loadQueue, loadQuarantine, saveQueue, completeJob, claimNextJob,
  getQueuePaths, getQuarantinePaths, replayQueueStateFromJournal } from '../../../tools/service/queue.js';
import { getQueueJournalPath, replayQueueJournal, saveQueueJournal } from '../../../tools/service/queue-journal.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir: root } = await prepareIsolatedTestCacheDir('queue-artifact-path-authority');
const queue = path.join(root, 'queue'), sentinel = path.join(root, 'outside.json');
const invalidIds = ['', '.', '..', '../outside', '..\\outside', 'C:outside', '/outside', 'CON', 'nul.data', 'job.', 'job ', 'bad\u0000id', null, 42];
try {
  await fs.writeFile(sentinel, 'outside sentinel');
  for (const [index, id] of invalidIds.entries()) {
    const absent = path.join(root, `not-created-${index}`);
    await assert.rejects(enqueueJob(absent, { id, repo: root }), { code: 'ERR_QUEUE_JOB_ID' });
    await assert.rejects(fs.stat(absent), { code: 'ENOENT' });
  }
  const admitted = await enqueueJob(queue, { id: 'safe-job', repo: root, mode: 'code' });
  assert.equal(admitted.job.reportPath, path.join(queue, 'reports/safe-job.json'));
  const claimed = await claimNextJob(queue, 'index', { ownerId: 'fixture-worker' });
  await completeJob(queue, claimed.id, 'done', { exitCode: 0 }, 'index', {
    ownerId: 'fixture-worker', expectedLeaseVersion: claimed.lease.version });
  assert.equal(JSON.parse(await fs.readFile(admitted.job.reportPath, 'utf8')).status, 'done');
  const queuePath = getQueuePaths(queue).queuePath;
  const valid = await fs.readFile(queuePath, 'utf8');
  const job = JSON.parse(valid).jobs[0];
  for (const corrupt of [{ ...job, id: '../../../outside' }, { ...job, reportPath: sentinel }, { ...job, logPath: sentinel }]) {
    const bytes = JSON.stringify({ jobs: [corrupt] });
    await fs.writeFile(queuePath, bytes);
    await assert.rejects(loadQueue(queue));
    await assert.rejects(claimNextJob(queue));
    await assert.rejects(completeJob(queue, 'safe-job', 'done', {}));
    assert.equal(await fs.readFile(queuePath, 'utf8'), bytes);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'outside sentinel');
    await assert.rejects(saveQueue(queue, { jobs: [corrupt] }));
  }
  await fs.writeFile(queuePath, valid);
  await fs.writeFile(getQuarantinePaths(queue).quarantinePath, JSON.stringify({ jobs: [{ ...job, reportPath: sentinel }] }));
  await assert.rejects(loadQuarantine(queue));
  await assert.rejects(saveQueueJournal(queue, null, [{ jobId: job.id, snapshot: { ...job, reportPath: sentinel } }]));
  const journalPath = getQueueJournalPath(queue);
  await fs.writeFile(journalPath, JSON.stringify({ jobId: job.id, snapshot: { ...job, id: '../outside' } }) + '\n');
  await assert.rejects(replayQueueStateFromJournal(queue), /job ID does not match|filename segment/);
  assert.throws(() => replayQueueJournal([{ jobId: '../outside', target: 'purge' }]), { code: 'ERR_QUEUE_JOB_ID' });
  await fs.writeFile(queuePath, '{broken queue');
  await assert.rejects(loadQueue(queue), SyntaxError, 'corrupt state cannot silently become an empty queue');
  await fs.writeFile(queuePath, valid);
  const logs = path.join(queue, 'logs'), originalLstat = fsSync.lstatSync;
  fsSync.lstatSync = (target, options) => {
    const stat = originalLstat(target, options);
    if (path.resolve(target) !== logs || !stat) return stat;
    return new Proxy(stat, { get(value, key) {
      if (key === 'isSymbolicLink') return () => true;
      const member = Reflect.get(value, key);
      return typeof member === 'function' ? member.bind(value) : member;
    } });
  };
  try {
    await assert.rejects(loadQueue(queue), { code: 'ERR_UNSAFE_FILE_PATH' });
    await assert.rejects(enqueueJob(queue, { id: 'new-job', repo: root }), { code: 'ERR_UNSAFE_FILE_PATH' });
  } finally { fsSync.lstatSync = originalLstat; }
  assert.equal(await fs.readFile(queuePath, 'utf8'), valid);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'outside sentinel');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Queue admission, stored state, replay and report writes reject invalid IDs and outside/link artifact authority.');

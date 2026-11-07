#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { compactQueueState, enqueueJob, loadQueue } from '../../../tools/service/queue.js';
import { cleanupOrphanArtifacts } from '../../../tools/service/repair.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-artifact-cleanup-'));
try {
  for (const operation of ['compaction', 'orphan-repair']) {
    const queue = path.join(root, operation), logs = path.join(queue, 'logs'), reports = path.join(queue, 'reports');
    await fs.mkdir(logs, { recursive: true }); await fs.mkdir(reports);
    await fs.writeFile(path.join(logs, 'orphan.log'), 'orphan');
    await fs.writeFile(path.join(reports, 'orphan.json'), '{}');
    const originalReadDir = fs.readdir;
    let injected = false, producer = null, producedJob;
    try {
      // Start an ordinary producer after reachability was read, immediately
      // before shared artifacts are enumerated. A common fence must hold it
      // until cleanup commits; a selected-partition lock cannot protect it.
      fs.readdir = async (target, ...args) => {
        if (path.resolve(target) === logs && !injected) {
          injected = true;
          producer = (async () => {
            const result = await enqueueJob(queue, { id: 'new-job', repo: root, mode: 'code' }, null, 'new-partition');
            assert.equal(result.ok, true);
            producedJob = result.job;
            await fs.writeFile(result.job.logPath, 'live log');
            await fs.writeFile(result.job.reportPath, '{"live":true}');
          })();
          await Promise.race([producer, delay(500)]);
        }
        return originalReadDir(target, ...args);
      };
      const result = operation === 'compaction'
        ? await compactQueueState(queue, 'index')
        : await cleanupOrphanArtifacts(queue, 'index');
      assert.equal(result.ok, true);
      assert.equal(injected, true);
      await producer;
      assert.equal((await loadQueue(queue, 'new-partition')).jobs[0].id, producedJob.id);
      assert.equal(await fs.readFile(producedJob.logPath, 'utf8'), 'live log', `${operation} preserves concurrent cross-partition logs`);
      assert.deepEqual(JSON.parse(await fs.readFile(producedJob.reportPath, 'utf8')), { live: true });
      await assert.rejects(fs.stat(path.join(logs, 'orphan.log')), { code: 'ENOENT' });
      await assert.rejects(fs.stat(path.join(reports, 'orphan.json')), { code: 'ENOENT' });
    } finally {
      fs.readdir = originalReadDir;
      await producer?.catch(() => {});
    }
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('compaction and orphan repair fence new queue partitions while retaining terminal/orphan cleanup');

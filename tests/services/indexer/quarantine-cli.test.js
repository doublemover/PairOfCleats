#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  claimNextJob,
  ensureQueueDir,
  enqueueJob,
  quarantineJob
} from '../../../tools/service/queue.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'indexer-service-quarantine-cli');
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const configPath = path.join(tempRoot, 'service.json');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await ensureQueueDir(queueDir);

const config = {
  queueDir,
  repos: [
    { id: 'repo', path: repoRoot, syncPolicy: 'none' }
  ]
};
await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));

await enqueueJob(queueDir, {
  id: 'job-cli-poison',
  createdAt: new Date().toISOString(),
  repo: repoRoot,
  repoRoot,
  mode: 'code',
  reason: 'test',
  stage: 'stage1'
}, null, 'index');
const claimed = await claimNextJob(queueDir, 'index', { ownerId: 'worker-cli' });
await quarantineJob(queueDir, claimed.id, 'cli-poison', 'index', {
  ownerId: 'worker-cli',
  expectedLeaseVersion: claimed.lease?.version ?? null,
  sourceStatus: 'running',
  result: {
    exitCode: 1,
    error: 'cli poison'
  }
});

const runCli = (...args) => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'tools', 'service', 'indexer-service.js'), ...args],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || `indexer-service ${args[0]} failed`);
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout || '{}');
};

const quarantineList = runCli('quarantine', '--config', configPath, '--json');
assert.equal(quarantineList.ok, true);
assert.equal(quarantineList.summary?.quarantined, 1);
assert.equal(quarantineList.jobs?.[0]?.id, 'job-cli-poison');

const quarantineInspect = runCli('quarantine', '--config', configPath, '--job', 'job-cli-poison', '--json');
assert.equal(quarantineInspect.job?.quarantine?.reason, 'cli-poison');

const retryPayload = runCli('retry-quarantined', '--config', configPath, '--job', 'job-cli-poison', '--json');
assert.equal(retryPayload.ok, true);
assert.equal(retryPayload.retriedFromId, 'job-cli-poison');
assert.notEqual(retryPayload.job?.id, 'job-cli-poison');

const statusPayload = runCli('status', '--config', configPath, '--json');
assert.equal(statusPayload.queue?.queued, 1);
assert.equal(statusPayload.quarantine?.retried, 1);

const purgePayload = runCli('purge-quarantined', '--config', configPath, '--job', 'job-cli-poison', '--json');
assert.equal(purgePayload.ok, true);
assert.equal(purgePayload.removed, 1);

const finalQuarantineList = runCli('quarantine', '--config', configPath, '--json');
assert.equal(finalQuarantineList.summary?.total, 0);

console.log('indexer service quarantine cli test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-indexer-daemon-'));
const repoRoot = path.join(tempRoot, 'repo');
const queueDir = path.join(tempRoot, 'queue');
const configPath = path.join(tempRoot, 'service.json');
const scriptPath = path.join(process.cwd(), 'tools', 'service', 'indexer-service.js');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'main.js'), 'export const value = 1;\n');

await fs.writeFile(
  configPath,
  JSON.stringify({
    queueDir,
    repos: [
      { id: 'repo', path: repoRoot, syncPolicy: 'none' }
    ],
    worker: {
      executionMode: 'daemon',
      concurrency: 4,
      daemon: {
        deterministic: true,
        sessionNamespace: 'tests-daemon-mode',
        health: {
          maxJobsBeforeRecycle: 32,
          probeEveryJobs: 1,
          maxDictionaryEntries: 16,
          maxTreeSitterEntries: 16,
          maxEmbeddingWarmEntries: 16,
          maxHeapUsedMb: 8192,
          maxHeapGrowthMb: 8192,
          maxHeapGrowthRatio: 100
        }
      }
    },
    queue: {
      maxRetries: 0
    }
  }, null, 2)
);

const env = applyTestEnv({
  cacheRoot: tempRoot,
  embeddings: 'off'
});

const runService = (...args) => {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    env
  });
  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || `indexer-service command failed: ${args.join(' ')}`
  );
  return result;
};

runService('enqueue', '--config', configPath, '--repo', repoRoot, '--stage', 'stage1', '--mode', 'code');
runService('enqueue', '--config', configPath, '--repo', repoRoot, '--stage', 'stage1', '--mode', 'code');
runService('work', '--config', configPath, '--concurrency', '3', '--json');

const queuePayload = JSON.parse(await fs.readFile(path.join(queueDir, 'queue.json'), 'utf8'));
const jobs = Array.isArray(queuePayload?.jobs) ? queuePayload.jobs : [];
assert.equal(jobs.length, 2, 'expected two jobs in queue history');

const [jobA, jobB] = jobs;
assert.equal(jobA.status, 'done', 'first daemon job should complete');
assert.equal(jobB.status, 'done', 'second daemon job should complete');
assert.equal(jobA?.result?.executionMode, 'daemon', 'first job should report daemon execution');
assert.equal(jobB?.result?.executionMode, 'daemon', 'second job should report daemon execution');
assert.ok(jobA?.result?.daemon?.sessionKey, 'first job should include daemon session key');
assert.equal(
  jobA?.result?.daemon?.sessionKey,
  jobB?.result?.daemon?.sessionKey,
  'daemon jobs for same repo should reuse the same session key'
);

const firstLog = await fs.readFile(jobA.logPath, 'utf8');
const secondLog = await fs.readFile(jobB.logPath, 'utf8');
assert.match(firstLog, /\[daemon\] started /, 'daemon run should write daemon start log');
assert.match(secondLog, /\[daemon\] started /, 'daemon run should write daemon start log for subsequent jobs');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('indexer service daemon mode test passed');

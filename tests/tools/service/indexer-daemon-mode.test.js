#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

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
      concurrency: 1,
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
  embeddings: 'off',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      typeInference: false,
      typeInferenceCrossFile: false,
      treeSitter: { enabled: false }
    },
    tooling: {
      autoEnableOnDetect: false,
      lsp: { enabled: false }
    }
  }
});

const runService = (...args) => {
  const result = runNode(
    [scriptPath, ...args],
    `indexer-service ${args.join(' ')}`,
    process.cwd(),
    env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );
  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || `indexer-service command failed: ${args.join(' ')}`
  );
  return result;
};

runService('enqueue', '--config', configPath, '--repo', repoRoot, '--stage', 'stage1', '--mode', 'code');
runService('work', '--config', configPath, '--concurrency', '1', '--json');

const queuePayload = JSON.parse(await fs.readFile(path.join(queueDir, 'queue.json'), 'utf8'));
const jobs = Array.isArray(queuePayload?.jobs) ? queuePayload.jobs : [];
assert.equal(jobs.length, 1, 'expected one job in queue history');

const [jobA] = jobs;
assert.equal(jobA.status, 'done', 'first daemon job should complete');
assert.equal(jobA?.result?.executionMode, 'daemon', 'first job should report daemon execution');
assert.ok(jobA?.result?.daemon?.sessionKey, 'first job should include daemon session key');

const firstLog = await fs.readFile(jobA.logPath, 'utf8');
assert.match(firstLog, /\[daemon\] started /, 'daemon run should write daemon start log');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('indexer service daemon mode test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildDiagnosticsReport } from '../../../tools/reports/diagnostics-report.js';
import { DEFAULT_SERVICE_CONFIG, loadServiceConfig, resolveRepoRegistry } from '../../../tools/service/config.js';
import { resolveQueueAdmissionPolicy } from '../../../tools/service/admission-policy.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'service-config-validation');
fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });

const validConfigPath = path.join(tempRoot, 'valid-service.json');
const invalidConfigPath = path.join(tempRoot, 'invalid-service.json');
const indexerScriptPath = path.join(root, 'tools', 'service', 'indexer-service.js');

fs.writeFileSync(validConfigPath, `${JSON.stringify({
  queueDir: path.join(tempRoot, 'queue'),
  queue: {
    maxQueued: '4',
    maxRetries: '2'
  },
  worker: {
    concurrency: '0',
    shutdownTimeoutMs: '500'
  },
  embeddings: {
    queue: {
      maxQueued: '3'
    },
    worker: {
      concurrency: '1',
      maxMemoryMb: '2048',
      shutdownTimeoutMs: '500'
    }
  },
  sync: {
    policy: 'fetch',
    intervalMs: '60000'
  },
  security: {
    allowShell: false,
    allowPathEscape: false
  }
}, null, 2)}\n`);

fs.writeFileSync(invalidConfigPath, `${JSON.stringify({
  queue: {
    maxQueued: -1
  },
  sync: {
    policy: 'fetch'
  }
}, null, 2)}\n`);

const loaded = loadServiceConfig(validConfigPath);
assert.equal(typeof loaded.queue.maxQueued, 'number', 'expected queue.maxQueued to be coerced to a number');
assert.equal(loaded.queue.maxQueued, 4, 'expected maxQueued string to be normalized');
assert.equal(loaded.worker.concurrency, 0, 'expected explicit zero concurrency to survive service-config loading');
assert.equal(typeof loaded.worker.concurrency, 'number', 'expected worker concurrency to be numeric after load');
assert.equal(typeof loaded.embeddings.worker.maxMemoryMb, 'number', 'expected embeddings maxMemoryMb to be numeric after load');
assert.equal(typeof loaded.sync.intervalMs, 'number', 'expected sync interval to be numeric after load');
assert.equal(loaded.sync.policy, 'fetch', 'expected valid sync policy to load');

assert.throws(
  () => loadServiceConfig(invalidConfigPath),
  /queue\.maxQueued/,
  'expected invalid queue limit to fail with field path'
);

await assert.rejects(
  () => buildDiagnosticsReport({
    reportKinds: 'queue-health',
    configPath: invalidConfigPath
  }),
  /queue\.maxQueued/,
  'expected diagnostics report to surface invalid service config'
);

const cliRun = runNode(
  [indexerScriptPath, 'status', '--config', invalidConfigPath, '--json'],
  'indexer service invalid config',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(cliRun.status, 0, 'expected invalid service config to fail the CLI');
const payload = JSON.parse(String(cliRun.stdout || '').trim());
assert.equal(payload.ok, false, 'expected JSON bootstrap error payload');
assert.equal(payload.code, 'INVALID_REQUEST', 'expected invalid-request error code');
assert.equal(payload.fieldPath, 'queue.maxQueued', 'expected offending field path');
assert.equal(typeof payload.hint, 'string', 'expected actionable hint');

for (const [parts, value] of [
  [['queue', 'maxRetries'], 3], [['worker', 'concurrency'], 2],
  [['embeddings', 'queue', 'maxRetries'], 3], [['embeddings', 'worker', 'concurrency'], 2],
  [['sync', 'intervalMs'], 60000], [['queue', 'retention', 'doneJobs'], 3],
  [['embeddings', 'queue', 'retention', 'failedJobs'], 2], [['security', 'allowShell'], true]
]) {
  const expected = structuredClone(DEFAULT_SERVICE_CONFIG), partial = {};
  let patch = partial, target = expected;
  for (const part of parts.slice(0, -1)) {
    patch[part] = {}; patch = patch[part]; target = target[part];
  }
  patch[parts.at(-1)] = value; target[parts.at(-1)] = value;
  const partialPath = path.join(tempRoot, 'partial.json');
  fs.writeFileSync(partialPath, JSON.stringify(partial));
  const actual = loadServiceConfig(partialPath);
  assert.deepEqual(actual, expected, `partial ${parts.join('.')} override preserves all unrelated defaults`);
  assert.equal(actual.embeddings.worker.maxMemoryMb, 4096, 'embedding child heap policy retains its default');
  assert.equal(resolveQueueAdmissionPolicy({ queueConfig: actual.queue, workerConfig: actual.worker }).maxQueued, 20);
}
const nullablePath = path.join(tempRoot, 'nullable.json');
fs.writeFileSync(nullablePath, JSON.stringify({ queue: { maxQueued: null } }));
assert.equal(loadServiceConfig(nullablePath).queue.maxQueued, null, 'explicit null remains distinct from omission');
for (const policy of ['none', 'fetch', 'pull']) {
  for (const spelling of [policy, policy.toUpperCase(), ` ${policy.toUpperCase()} `]) {
    const policyPath = path.join(tempRoot, 'policy.json');
    fs.writeFileSync(policyPath, JSON.stringify({ sync: { policy: spelling }, repos: [{ path: tempRoot, syncPolicy: spelling }] }));
    const parsed = loadServiceConfig(policyPath);
    assert.equal(parsed.sync.policy, policy, 'global dispatch policy is canonical');
    assert.equal(parsed.repos[0].syncPolicy, policy, 'repo override dispatch policy is canonical');
  }
}
const registryPath = path.join(tempRoot, 'registry.json'), fileConfigPath = path.join(tempRoot, 'file-config.json');
fs.writeFileSync(registryPath, JSON.stringify({ repos: [{ path: tempRoot, syncPolicy: ' FETCH ' }] }));
fs.writeFileSync(fileConfigPath, JSON.stringify({ reposFile: 'registry.json' }));
assert.equal(resolveRepoRegistry(loadServiceConfig(fileConfigPath), fileConfigPath)[0].syncPolicy, 'fetch');
fs.writeFileSync(fileConfigPath, JSON.stringify({ repos: [], reposFile: 'registry.json' }));
assert.deepEqual(resolveRepoRegistry(loadServiceConfig(fileConfigPath), fileConfigPath), [], 'explicit empty inline registry retains precedence');
console.log('service config validation test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildDiagnosticsReport } from '../../../tools/reports/diagnostics-report.js';
import { loadServiceConfig } from '../../../tools/service/config.js';
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
    maxQueued: 4,
    maxRetries: 2
  },
  worker: {
    concurrency: 0,
    shutdownTimeoutMs: 500
  },
  embeddings: {
    worker: {
      concurrency: 1,
      maxMemoryMb: 2048,
      shutdownTimeoutMs: 500
    }
  },
  sync: {
    policy: 'fetch',
    intervalMs: 60000
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
    policy: 'push'
  }
}, null, 2)}\n`);

const loaded = loadServiceConfig(validConfigPath);
assert.equal(loaded.worker.concurrency, 0, 'expected explicit zero concurrency to survive service-config loading');
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

console.log('service config validation test passed');

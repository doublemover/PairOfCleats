#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../helpers/test-env.js';

const ROOT = process.cwd();
const gatePath = path.join(ROOT, 'tools', 'ci', 'tooling-lsp-slo-gate.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-tooling-lsp-slo-sampling-'));
const jsonPath = path.join(tempRoot, 'tooling-lsp-slo-gate.json');
const doctorPath = path.join(tempRoot, 'tooling-doctor-report.json');

const doctorPayload = {
  schemaVersion: 2,
  providers: [
    {
      id: 'clangd',
      enabled: true,
      available: false,
      languages: ['c', 'cpp'],
      handshake: { ok: false, latencyMs: 0, errorCode: 'ERR_MISSING', errorMessage: 'missing' }
    },
    {
      id: 'pyright',
      enabled: true,
      available: true,
      languages: ['python'],
      handshake: { ok: false, latencyMs: 0, errorCode: 'ERR_TIMEOUT', errorMessage: 'timed out' }
    },
    {
      id: 'sourcekit',
      enabled: true,
      available: true,
      languages: ['swift'],
      handshake: { ok: true, latencyMs: 55, errorCode: null, errorMessage: null }
    }
  ]
};
await fs.writeFile(doctorPath, `${JSON.stringify(doctorPayload, null, 2)}\n`, 'utf8');

try {
  const result = spawnSync(
    process.execPath,
    [gatePath, '--mode', 'ci', '--doctor', doctorPath, '--json', jsonPath],
    {
      cwd: ROOT,
      env: applyTestEnv({ syncProcess: false }),
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 0, `expected tooling lsp slo gate status=0, received ${result.status}`);

  const payload = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  assert.equal(payload?.sampleCount, 2, 'expected unavailable providers to be excluded from sampling');
  assert.equal(payload?.metrics?.measuredAttempts, 2, 'expected one attempt per available provider');
  assert.equal(payload?.metrics?.timedOut, 1, 'expected one timed out attempt');
  assert.equal(payload?.metrics?.fatalFailures, 0, 'expected timeout attempts not to count as fatal failures');
  assert.equal(payload?.metrics?.timeoutRatio, 0.5, 'expected timeout ratio to use attempts');
  assert.equal(payload?.metrics?.fatalFailureRate, 0, 'expected fatal failure rate to exclude timeout attempts');
  assert.equal(
    payload.samples.some((sample) => sample.providerId === 'clangd'),
    false,
    'expected unavailable providers to be excluded from live probe sampling'
  );

  console.log('tooling lsp slo gate sampling test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

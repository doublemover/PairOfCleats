#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../helpers/test-env.js';

const ROOT = process.cwd();
const gatePath = path.join(ROOT, 'tools', 'ci', 'tooling-lsp-slo-gate.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-tooling-lsp-slo-tail-p95-'));
const jsonPath = path.join(tempRoot, 'tooling-lsp-slo-gate.json');
const doctorPath = path.join(tempRoot, 'tooling-doctor-report.json');

const doctorPayload = {
  schemaVersion: 2,
  providers: [
    {
      id: 'clangd',
      enabled: true,
      available: true,
      languages: ['c', 'cpp'],
      handshake: { ok: true, latencyMs: 40, errorCode: null, errorMessage: null }
    },
    {
      id: 'pyright',
      enabled: true,
      available: true,
      languages: ['python'],
      handshake: { ok: true, latencyMs: 50, errorCode: null, errorMessage: null }
    },
    {
      id: 'sourcekit',
      enabled: true,
      available: true,
      languages: ['swift'],
      handshake: { ok: true, latencyMs: 5000, errorCode: null, errorMessage: null }
    }
  ]
};
await fs.writeFile(doctorPath, `${JSON.stringify(doctorPayload, null, 2)}\n`, 'utf8');

try {
  const result = spawnSync(
    process.execPath,
    [
      gatePath,
      '--mode',
      'ci',
      '--doctor',
      doctorPath,
      '--json',
      jsonPath,
      '--max-p95-ms',
      '1000'
    ],
    {
      cwd: ROOT,
      env: applyTestEnv({ syncProcess: false }),
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 3, `expected gating failure status=3, received ${result.status}`);

  const raw = await fs.readFile(jsonPath, 'utf8');
  const payload = JSON.parse(raw);
  assert.equal(payload?.status, 'error', 'expected gate status=error');
  assert.equal(Number(payload?.metrics?.maxP95Ms), 5000, 'expected p95 to preserve tail latency');
  assert.equal(
    Array.isArray(payload?.failures) && payload.failures.some((entry) => String(entry).includes('max p95')),
    true,
    'expected max p95 failure'
  );

  console.log('tooling lsp slo gate tail p95 test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

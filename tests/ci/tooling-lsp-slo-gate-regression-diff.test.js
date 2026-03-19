#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../helpers/test-env.js';

const ROOT = process.cwd();
const gatePath = path.join(ROOT, 'tools', 'ci', 'tooling-lsp-slo-gate.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-tooling-lsp-slo-gate-diff-'));
const jsonPath = path.join(tempRoot, 'tooling-lsp-slo-gate.json');
const doctorPath = path.join(tempRoot, 'tooling-doctor-report.json');
const baselinePath = path.join(tempRoot, 'baseline.json');

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
      handshake: { ok: true, latencyMs: 30, errorCode: null, errorMessage: null }
    },
    {
      id: 'sourcekit',
      enabled: true,
      available: true,
      languages: ['swift'],
      handshake: { ok: true, latencyMs: 50, errorCode: null, errorMessage: null }
    }
  ]
};

await fs.writeFile(doctorPath, `${JSON.stringify(doctorPayload, null, 2)}\n`, 'utf8');
await fs.writeFile(baselinePath, `${JSON.stringify({
  metrics: {
    requests: 2,
    timeoutRatio: 0.25,
    fatalFailureRate: 0.1,
    enrichmentCoverage: 0.5,
    maxP95Ms: 250
  }
}, null, 2)}\n`, 'utf8');

try {
  const result = spawnSync(
    process.execPath,
    [gatePath, '--mode', 'ci', '--doctor', doctorPath, '--baseline', baselinePath, '--json', jsonPath],
    {
      cwd: ROOT,
      env: applyTestEnv({ syncProcess: false }),
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    console.error('tooling lsp slo gate regression diff test failed');
    console.error(result.stderr || result.stdout || '');
  }
  assert.equal(result.status, 0, `expected tooling lsp slo gate status=0, received ${result.status}`);

  const payload = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  assert.ok(payload?.regressionDiff && typeof payload.regressionDiff === 'object', 'expected regression diff payload');
  assert.equal(Number.isFinite(Number(payload.regressionDiff.requestsDelta)), true, 'expected numeric requests delta');
  assert.equal(Number.isFinite(Number(payload.regressionDiff.maxP95MsDelta)), true, 'expected numeric p95 delta');

  console.log('tooling lsp slo gate regression diff test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

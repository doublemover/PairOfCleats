#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../helpers/test-env.js';

const ROOT = process.cwd();
const gatePath = path.join(ROOT, 'tools', 'ci', 'tooling-lsp-slo-gate.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-tooling-lsp-slo-gate-'));
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
      handshake: { ok: true, latencyMs: 35, errorCode: null, errorMessage: null }
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

  if (result.status !== 0) {
    console.error('tooling lsp slo gate smoke test failed');
    console.error(result.stderr || result.stdout || '');
  }
  assert.equal(result.status, 0, `expected tooling lsp slo gate status=0, received ${result.status}`);

  const raw = await fs.readFile(jsonPath, 'utf8');
  const payload = JSON.parse(raw);
  assert.equal(payload?.status, 'ok', `expected status=ok, received ${String(payload?.status)}`);
  assert.equal(Number(payload?.sampleCount) >= 3, true, 'expected at least three provider samples');
  assert.equal(
    Number(payload?.metrics?.enrichmentCoverage || 0) > 0,
    true,
    'expected positive enrichment coverage'
  );

  console.log('tooling lsp slo gate smoke test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

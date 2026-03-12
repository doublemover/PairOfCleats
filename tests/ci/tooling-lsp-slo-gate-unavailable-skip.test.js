#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../helpers/test-env.js';

const ROOT = process.cwd();
const gatePath = path.join(ROOT, 'tools', 'ci', 'tooling-lsp-slo-gate.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-tooling-lsp-slo-unavailable-skip-'));
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
      available: false,
      languages: ['python'],
      handshake: { ok: false, latencyMs: 0, errorCode: 'ERR_TOOL_MISSING', errorMessage: 'missing' }
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
    [gatePath, '--mode', 'ci', '--doctor', doctorPath, '--json', jsonPath, '--min-provider-samples', '2'],
    {
      cwd: ROOT,
      env: applyTestEnv({ syncProcess: false }),
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    console.error('tooling lsp slo gate unavailable skip test failed');
    console.error(result.stderr || result.stdout || '');
  }
  assert.equal(result.status, 0, `expected tooling lsp slo gate status=0, received ${result.status}`);

  const payload = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  assert.equal(payload?.sampleCount, 2, 'expected unavailable providers to be excluded from sampling');
  assert.deepEqual(
    payload?.samples?.map((sample) => sample.providerId),
    ['clangd', 'sourcekit'],
    'expected only available providers to be sampled'
  );

  console.log('tooling lsp slo gate unavailable skip test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const gatePath = path.join(ROOT, 'tools', 'ci', 'tooling-lsp-default-enable-gate.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-tooling-lsp-default-enable-gate-'));
const policyPath = path.join(tempRoot, 'policy.json');
const doctorPath = path.join(tempRoot, 'doctor.json');
const sloPath = path.join(tempRoot, 'slo.json');
const jsonPath = path.join(tempRoot, 'tooling-lsp-default-enable-gate.json');

try {
  await fs.writeFile(policyPath, JSON.stringify({
    schemaVersion: 1,
    providers: [{ id: 'clangd', defaultEnabled: true }]
  }, null, 2), 'utf8');
  await fs.writeFile(doctorPath, JSON.stringify({
    providers: [{ id: 'clangd', enabled: true, available: true, status: 'ok' }]
  }, null, 2), 'utf8');
  await fs.writeFile(sloPath, JSON.stringify({ status: 'ok' }, null, 2), 'utf8');

  const result = spawnSync(
    process.execPath,
    [
      gatePath,
      '--policy',
      policyPath,
      '--doctor',
      doctorPath,
      '--slo',
      sloPath,
      '--json',
      jsonPath
    ],
    {
      cwd: ROOT,
      env: { ...process.env, PAIROFCLEATS_TESTING: '1' },
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    console.error('tooling lsp default-enable gate smoke test failed');
    console.error(result.stderr || result.stdout || '');
  }
  assert.equal(result.status, 0, `expected tooling lsp default-enable gate status=0, received ${result.status}`);

  const raw = await fs.readFile(jsonPath, 'utf8');
  const payload = JSON.parse(raw);
  assert.equal(payload?.status, 'ok', `expected status=ok, received ${String(payload?.status)}`);
  assert.equal(payload?.defaultEnabledProviderCount, 1, 'expected one default-enabled provider');

  console.log('tooling lsp default-enable gate smoke test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

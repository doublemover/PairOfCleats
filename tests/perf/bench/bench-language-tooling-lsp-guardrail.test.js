#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-bench-tooling-guardrail-'));
const reportPath = path.join(tempRoot, 'bench-report.json');
const jsonPath = path.join(tempRoot, 'guardrail.json');

await fs.writeFile(reportPath, JSON.stringify({
  tasks: [
    { summary: { latencyMsAvg: { memory: 12.3 } } },
    { summary: { latencyMsAvg: { memory: 9.1 } } }
  ],
  diagnostics: {
    crashRetention: { retainedCount: 0 }
  },
  throughputLedger: {
    topRegressions: []
  }
}, null, 2), 'utf8');

const scriptPath = path.join(root, 'tools', 'bench', 'language', 'tooling-lsp-guardrail.js');
const result = spawnSync(
  process.execPath,
  [scriptPath, '--report', reportPath, '--json', jsonPath],
  { cwd: root, env: { ...process.env, PAIROFCLEATS_TESTING: '1' }, encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error('bench-language tooling lsp guardrail test failed');
  console.error(result.stderr || result.stdout || '');
}
assert.equal(result.status, 0, `expected guardrail exit code 0, received ${result.status}`);
const payload = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
assert.equal(payload?.status, 'ok', `expected status=ok, received ${String(payload?.status)}`);
assert.equal(payload?.metrics?.summaryCoverage, 1, 'expected full summary coverage');

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('bench-language tooling lsp guardrail test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testLogs', `bench-tooling-guardrail-${process.pid}-${Date.now()}`);
const scriptPath = path.join(root, 'tools', 'bench', 'language', 'tooling-lsp-guardrail.js');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const runGuardrail = (reportPath, jsonPath) => spawnSync(
  process.execPath,
  [scriptPath, '--report', reportPath, '--json', jsonPath],
  { cwd: root, env: applyTestEnv({ syncProcess: false }), encoding: 'utf8' }
);

const benchReportPath = path.join(tempRoot, 'bench-report.json');
const benchJsonPath = path.join(tempRoot, 'bench-guardrail.json');
await fs.writeFile(benchReportPath, JSON.stringify({
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
const benchResult = runGuardrail(benchReportPath, benchJsonPath);
if (benchResult.status !== 0) {
  console.error('bench-language tooling lsp guardrail test failed');
  console.error(benchResult.stderr || benchResult.stdout || '');
}
assert.equal(benchResult.status, 0, `expected guardrail exit code 0, received ${benchResult.status}`);
const benchPayload = JSON.parse(await fs.readFile(benchJsonPath, 'utf8'));
assert.equal(benchPayload?.status, 'ok', `expected status=ok, received ${String(benchPayload?.status)}`);
assert.equal(benchPayload?.metrics?.summaryCoverage, 1, 'expected full summary coverage');

const sloReportPath = path.join(tempRoot, 'slo-report.json');
const sloJsonPath = path.join(tempRoot, 'slo-guardrail.json');
await fs.writeFile(sloReportPath, JSON.stringify({
  sampleCount: 500,
  metrics: {
    requests: 500,
    enrichmentCoverage: 0.95,
    fatalFailures: 1,
    timedOut: 40
  }
}, null, 2), 'utf8');
const sloResult = runGuardrail(sloReportPath, sloJsonPath);
if (sloResult.status !== 0) {
  console.error('bench-language tooling lsp guardrail slo scaling test failed');
  console.error(sloResult.stderr || sloResult.stdout || '');
}
assert.equal(sloResult.status, 0, `expected slo guardrail exit code 0, received ${sloResult.status}`);
const sloPayload = JSON.parse(await fs.readFile(sloJsonPath, 'utf8'));
assert.equal(sloPayload?.status, 'ok', `expected SLO status=ok, received ${String(sloPayload?.status)}`);
assert.equal(sloPayload?.metrics?.topRegressionCount, 40, 'expected timedOut count in metrics');
assert.equal(sloPayload?.metrics?.timeoutAbsoluteScaledMax, 100, 'expected sample-scaled absolute timeout max');

const sloFailReportPath = path.join(tempRoot, 'slo-fail-report.json');
const sloFailJsonPath = path.join(tempRoot, 'slo-fail-guardrail.json');
await fs.writeFile(sloFailReportPath, JSON.stringify({
  sampleCount: 500,
  metrics: {
    requests: 500,
    enrichmentCoverage: 0.95,
    fatalFailures: 0,
    timedOut: 130
  }
}, null, 2), 'utf8');
const sloFailResult = runGuardrail(sloFailReportPath, sloFailJsonPath);
assert.equal(sloFailResult.status, 3, `expected failing slo guardrail exit code 3, received ${sloFailResult.status}`);
const sloFailPayload = JSON.parse(await fs.readFile(sloFailJsonPath, 'utf8'));
assert.equal(sloFailPayload?.status, 'error', `expected SLO failure status=error, received ${String(sloFailPayload?.status)}`);
assert.ok(
  Array.isArray(sloFailPayload?.failures) && sloFailPayload.failures.some((entry) => String(entry).includes('timed out ratio')),
  'expected timed out ratio failure message for high timeout ratio'
);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('bench-language tooling lsp guardrail test passed');

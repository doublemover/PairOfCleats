#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  cleanupGateFixture,
  doctorReport,
  logGateFailure,
  lspProvider,
  prepareGateFixture,
  readGatePayload,
  runGate,
  writeJsonFile
} from '../helpers/tooling-lsp-slo-gate.js';

const fixture = await prepareGateFixture({
  prefix: 'pairofcleats-tooling-lsp-slo-gate-input-',
  doctorFileName: 'tooling_doctor_report.json',
  doctorPayload: doctorReport([
    lspProvider({ id: 'clangd', latencyMs: 40 }),
    lspProvider({ id: 'pyright', latencyMs: 35 }),
    lspProvider({ id: 'sourcekit', latencyMs: 55 })
  ])
});
const doctorGatePayloadPath = path.join(fixture.tempRoot, 'tooling-doctor-gate.json');
const doctorGatePayload = {
  status: 'ok',
  reportPath: fixture.doctorPath,
  summary: { status: 'warn', errors: 0, warnings: 1 }
};
await writeJsonFile(doctorGatePayloadPath, doctorGatePayload);

try {
  const result = runGate(['--mode', 'ci', '--doctor', doctorGatePayloadPath, '--json', fixture.jsonPath]);

  logGateFailure('tooling lsp slo gate doctor-gate-input smoke test failed', result);
  assert.equal(result.status, 0, `expected tooling lsp slo gate status=0, received ${result.status}`);

  const payload = await readGatePayload(fixture.jsonPath);
  assert.equal(payload?.status, 'ok', `expected status=ok, received ${String(payload?.status)}`);
  assert.equal(Number(payload?.sampleCount) >= 3, true, 'expected at least three provider samples');
  assert.equal(
    path.resolve(String(payload?.doctorPath || '')),
    path.resolve(fixture.doctorPath),
    'expected gate to resolve reportPath from doctor gate payload input'
  );

  console.log('tooling lsp slo gate doctor gate input smoke test passed');
} finally {
  await cleanupGateFixture(fixture);
}

#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  cleanupGateFixture,
  doctorReport,
  logGateFailure,
  lspProvider,
  prepareGateFixture,
  readGatePayload,
  runGate
} from '../helpers/tooling-lsp-slo-gate.js';

const fixture = await prepareGateFixture({
  prefix: 'pairofcleats-tooling-lsp-slo-gate-diff-',
  doctorPayload: doctorReport([
    lspProvider({ id: 'clangd', latencyMs: 40 }),
    lspProvider({ id: 'pyright', latencyMs: 30 }),
    lspProvider({ id: 'sourcekit', latencyMs: 50 })
  ]),
  baselinePayload: {
    metrics: {
      requests: 2,
      timeoutRatio: 0.25,
      fatalFailureRate: 0.1,
      enrichmentCoverage: 0.5,
      maxP95Ms: 250
    }
  }
});

try {
  const result = runGate([
    '--mode',
    'ci',
    '--doctor',
    fixture.doctorPath,
    '--baseline',
    fixture.baselinePath,
    '--json',
    fixture.jsonPath
  ]);

  logGateFailure('tooling lsp slo gate regression diff test failed', result);
  assert.equal(result.status, 0, `expected tooling lsp slo gate status=0, received ${result.status}`);

  const payload = await readGatePayload(fixture.jsonPath);
  assert.ok(payload?.regressionDiff && typeof payload.regressionDiff === 'object', 'expected regression diff payload');
  assert.equal(Number.isFinite(Number(payload.regressionDiff.requestsDelta)), true, 'expected numeric requests delta');
  assert.equal(Number.isFinite(Number(payload.regressionDiff.maxP95MsDelta)), true, 'expected numeric p95 delta');

  console.log('tooling lsp slo gate regression diff test passed');
} finally {
  await cleanupGateFixture(fixture);
}

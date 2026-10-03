#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  cleanupGateFixture,
  doctorReport,
  lspProvider,
  prepareGateFixture,
  readGatePayload,
  runGate
} from '../helpers/tooling-lsp-slo-gate.js';

const fixture = await prepareGateFixture({
  prefix: 'pairofcleats-tooling-lsp-slo-sampling-',
  doctorPayload: doctorReport([
    lspProvider({ id: 'clangd', available: false, ok: false, errorCode: 'ERR_MISSING', errorMessage: 'missing' }),
    lspProvider({ id: 'pyright', ok: false, latencyMs: 0, errorCode: 'ERR_TIMEOUT', errorMessage: 'timed out' }),
    lspProvider({ id: 'sourcekit', latencyMs: 55 })
  ])
});

try {
  const result = runGate(['--mode', 'ci', '--doctor', fixture.doctorPath, '--json', fixture.jsonPath]);

  assert.equal(result.status, 0, `expected tooling lsp slo gate status=0, received ${result.status}`);

  const payload = await readGatePayload(fixture.jsonPath);
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
  await cleanupGateFixture(fixture);
}

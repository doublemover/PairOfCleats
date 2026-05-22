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
  prefix: 'poc-tooling-lsp-slo-unavailable-skip-',
  doctorPayload: doctorReport([
    lspProvider({ id: 'clangd', latencyMs: 40 }),
    lspProvider({ id: 'pyright', available: false, ok: false, errorCode: 'ERR_TOOL_MISSING', errorMessage: 'missing' }),
    lspProvider({ id: 'sourcekit', latencyMs: 55 })
  ])
});

try {
  const result = runGate([
    '--mode',
    'ci',
    '--doctor',
    fixture.doctorPath,
    '--json',
    fixture.jsonPath,
    '--min-provider-samples',
    '2'
  ]);

  logGateFailure('tooling lsp slo gate unavailable skip test failed', result);
  assert.equal(result.status, 0, `expected tooling lsp slo gate status=0, received ${result.status}`);

  const payload = await readGatePayload(fixture.jsonPath);
  assert.equal(payload?.sampleCount, 2, 'expected unavailable providers to be excluded from sampling');
  assert.deepEqual(
    payload?.samples?.map((sample) => sample.providerId),
    ['clangd', 'sourcekit'],
    'expected only available providers to be sampled'
  );

  console.log('tooling lsp slo gate unavailable skip test passed');
} finally {
  await cleanupGateFixture(fixture);
}

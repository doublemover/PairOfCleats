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
  prefix: 'poc-tooling-lsp-slo-tail-p95-',
  doctorPayload: doctorReport([
    lspProvider({ id: 'clangd', latencyMs: 40 }),
    lspProvider({ id: 'pyright', latencyMs: 50 }),
    lspProvider({ id: 'sourcekit', latencyMs: 5000 })
  ])
});

try {
  const resultInformational = runGate(
    [
      '--mode',
      'ci',
      '--doctor',
      fixture.doctorPath,
      '--json',
      fixture.jsonPath,
      '--max-p95-ms',
      '1000'
    ]
  );

  assert.equal(
    resultInformational.status,
    0,
    `expected informational status=0 without --enforce, received ${resultInformational.status}`
  );

  const payload = await readGatePayload(fixture.jsonPath);
  assert.equal(payload?.status, 'warn', 'expected gate status=warn without enforce');
  assert.equal(Number(payload?.metrics?.maxP95Ms), 5000, 'expected p95 to preserve tail latency');
  assert.equal(
    Array.isArray(payload?.failures) && payload.failures.some((entry) => String(entry).includes('max p95')),
    true,
    'expected max p95 failure'
  );
  const resultEnforced = runGate(
    [
      '--mode',
      'ci',
      '--doctor',
      fixture.doctorPath,
      '--json',
      fixture.jsonPath,
      '--max-p95-ms',
      '1000',
      '--enforce'
    ]
  );
  assert.equal(resultEnforced.status, 3, `expected enforced gate failure status=3, received ${resultEnforced.status}`);
  const enforcedPayload = await readGatePayload(fixture.jsonPath);
  assert.equal(enforcedPayload?.status, 'error', 'expected gate status=error with --enforce');

  console.log('tooling lsp slo gate tail p95 test passed');
} finally {
  await cleanupGateFixture(fixture);
}

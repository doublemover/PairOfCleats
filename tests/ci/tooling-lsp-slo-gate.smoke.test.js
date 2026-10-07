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
  prefix: 'pairofcleats-tooling-lsp-slo-gate-',
  doctorPayload: doctorReport([
    lspProvider({ id: 'clangd', latencyMs: 40 }),
    lspProvider({ id: 'pyright', latencyMs: 35 }),
    lspProvider({ id: 'sourcekit', latencyMs: 55 })
  ])
});

try {
  const result = runGate(['--mode', 'ci', '--doctor', fixture.doctorPath, '--json', fixture.jsonPath]);

  logGateFailure('tooling lsp slo gate smoke test failed', result);
  assert.equal(result.status, 0, `expected tooling lsp slo gate status=0, received ${result.status}`);

  const payload = await readGatePayload(fixture.jsonPath);
  assert.equal(payload?.status, 'ok', `expected status=ok, received ${String(payload?.status)}`);
  assert.equal(Number(payload?.sampleCount) >= 3, true, 'expected at least three provider samples');
  assert.equal(
    Number(payload?.metrics?.enrichmentCoverage || 0) > 0,
    true,
    'expected positive enrichment coverage'
  );

  console.log('tooling lsp slo gate smoke test passed');
} finally {
  await cleanupGateFixture(fixture);
}

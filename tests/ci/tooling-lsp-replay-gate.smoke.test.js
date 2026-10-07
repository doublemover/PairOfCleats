#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { createJsonGateHarness } from '../helpers/json-gate.js';

const ROOT = process.cwd();
const harness = await createJsonGateHarness({
  rootDir: ROOT,
  scriptRelativePath: path.join('tools', 'ci', 'tooling-lsp-replay-gate.js'),
  tempPrefix: 'pairofcleats-tooling-lsp-replay-gate-',
  jsonFileName: 'tooling-lsp-replay-gate.json'
});

try {
  const result = harness.run([], { label: 'tooling lsp replay gate smoke test' });

  if (result.status !== 0) {
    console.error('tooling lsp replay gate smoke test failed');
    console.error(result.stderr || result.stdout || '');
  }
  assert.equal(result.status, 0, `expected tooling lsp replay gate status=0, received ${result.status}`);

  const payload = await harness.readPayload();
  assert.equal(payload?.status, 'ok', `expected status=ok, received ${String(payload?.status)}`);
  assert.equal(Array.isArray(payload?.summary?.outboundRequests), true, 'expected outbound request summary');
  assert.equal(payload.summary.outboundRequests.includes('initialize'), true, 'expected initialize in replay trace');
  assert.equal(payload.summary.outboundRequests.includes('textDocument/hover'), true, 'expected hover in replay trace');
  assert.equal(Number(payload?.summary?.pendingRequestCount || 0), 0, 'expected replay summary without pending requests');

  console.log('tooling lsp replay gate smoke test passed');
} finally {
  await harness.cleanup();
}

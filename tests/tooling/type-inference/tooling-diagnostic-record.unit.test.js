#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildToolingDiagnosticRecord, redactToolingDiagnosticText } from '../../../src/index/type-inference-crossfile/tooling-diagnostic-record.js';

const diagnostics = { diagnosticsSource: 'live', checks: [{ name: 'gopls_workspace_module_missing', status: 'warn',
  message: 'No go.mod at packages/example; runtime remained partial.' }],
preflight: { state: 'degraded', reasonCode: 'workspace-model', cached: false, durationMs: 17,
  commandProfile: { resolved: { cmd: '/managed/gopls', args: ['--token', 'fixture-only-secret'] },
    probe: { stdout: 'gopls v0.21.1', outcome: 'success', status: 0 } } },
fidelity: { state: 'degraded', contributes: true, semanticCoverage: { state: 'partial', contributedChunkCount: 105 } },
runtime: { requests: { byMethod: { 'textDocument/hover': { requests: 3, timedOut: 2, failed: 0 } } },
  health: { stderrPath: '/controlled/tooling.stderr.log' }, environment: { credential: 'fixture-only-secret' } }
};
const original = JSON.stringify(diagnostics);
const record = buildToolingDiagnosticRecord({ providerId: 'gopls', providerContractVersion: '1.0.0', diagnostics });
assert.equal(record.checks[0].name, 'gopls_workspace_module_missing');
assert.equal(record.checks[0].message, diagnostics.checks[0].message);
assert.equal(record.preflight.reasonCode, 'workspace-model');
assert.equal(record.preflight.cached, false);
assert.equal(record.preflight.commandProfile.resolved.cmd, '/managed/gopls');
assert.equal(record.preflight.commandProfile.probe.stdout, 'gopls v0.21.1');
assert.equal(record.fidelity.semanticCoverage.state, 'partial');
assert.equal(record.runtime.health.stderrPath, '/controlled/tooling.stderr.log');
assert.equal(record.runtime.requests.byMethod['textDocument/hover'].timedOut, 2);
assert.ok(!JSON.stringify(record).includes('fixture-only-secret'));
assert.equal(JSON.stringify(diagnostics), original, 'retention never mutates provider output or cache ownership');
const cached = buildToolingDiagnosticRecord({ providerId: 'gopls', diagnostics: { ...diagnostics, diagnosticsSource: 'cache' } });
assert.equal(cached.runtime, null, 'cached counters are not attributed to this live run');
assert.equal(cached.cachedRuntimeOmitted, true);
assert.equal(cached.preflight.reasonCode, 'workspace-model');
assert.equal(buildToolingDiagnosticRecord({ providerId: 'fixture', diagnostics: { ...diagnostics,
  diagnosticsSource: 'cache-suppressed' } }).cachedRuntimeOmitted, true, 'actual orchestrator lifetime label is preserved');
for (const text of ['Authorization: Bearer fixture-secret', 'https://fixture:secret@example.invalid/path',
  'https://example.invalid/path?access_token=fixture-secret', 'password=fixture-secret']) {
  assert.ok(!redactToolingDiagnosticText(text).includes('fixture-secret'));
}
assert.equal(redactToolingDiagnosticText('https://fixture:privatevalue', 25), 'https://[redacted]@', 'credential truncation still redacts a partial URL');
const cycle = {}; cycle.self = cycle;
const bounded = buildToolingDiagnosticRecord({ providerId: 'fixture', maxChars: 1024,
  diagnostics: { checks: Array.from({ length: 50 }, (_, index) => ({ name: `cause-${index}`, status: 'warn', message: 'x'.repeat(4000) })),
    preflight: cycle, runtime: diagnostics.runtime } });
assert.ok(JSON.stringify(bounded).length <= 1024);
assert.equal(bounded.truncated, true);
assert.equal(bounded.reportedCheckCount, 50);
assert.equal(bounded.checks[0].name, 'cause-0');
const lateFailure = buildToolingDiagnosticRecord({ providerId: 'fixture', diagnostics: { checks: [
  ...Array.from({ length: 100 }, () => ({ name: 'healthy', status: 'ok', message: 'ready' })),
  { name: 'initiating_failure', status: 'warn', message: 'missing compiler' }
] } });
assert.equal(lateFailure.checks[0].name, 'initiating_failure', 'failures take priority over routine checks within the bounded scan');
console.log('Bounded cause/version/workspace/runtime retention, cache lifetime, redaction and nonmutation pass.');

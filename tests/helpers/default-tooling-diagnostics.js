import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// These sample-repository integrations exercise normal provider selection.
// Optional command absence and project-loader trust rejections are expected;
// crashes, timeouts, protocol failures and any other degraded check are not.
const EXPECTED_WARNINGS = new Map([
  ['clangd', new Set(['clangd_command_unavailable'])],
  ['pyright', new Set()],
  ['sourcekit', new Set(['sourcekit_command_unavailable', 'sourcekit_workspace_trust_required'])],
  ['rust-analyzer', new Set(['rust_workspace_trust_required', 'lsp_command_unavailable'])]
]);

export const assertDefaultToolingDiagnostics = async ({ repoCacheRoot, startedAt, messages = null }) => {
  const filename = path.join(repoCacheRoot, 'tooling-cache', 'diagnostics', 'tooling.json');
  const report = JSON.parse(await fs.readFile(filename, 'utf8'));
  assert.equal(report.schemaVersion, 1);
  assert.ok(Date.parse(report.generatedAt) >= startedAt, 'provider evidence was written by this build');
  assert.equal(report.truncated, false);
  assert.equal(report.reportedProviderCount, report.providers.length);
  assert.deepEqual(report.providers.map(record => record.providerId).sort(), [...EXPECTED_WARNINGS.keys()].sort(),
    'the real sample exercises all four detected provider routes');
  const degraded = [], reasons = new Set();
  for (const record of report.providers) {
    assert.equal(record.preflight?.timedOut, false);
    assert.ok(['ready', 'blocked'].includes(record.preflight.state));
    const warnings = record.checks.filter(check => check.status === 'warn');
    assert.ok(!record.checks.some(check => check.status === 'error'), JSON.stringify(record));
    for (const check of warnings) {
      assert.ok(EXPECTED_WARNINGS.get(record.providerId).has(check.name), JSON.stringify(check));
      reasons.add(check.name);
    }
    if (warnings.length) degraded.push(record.providerId);
    if (record.preflight.state === 'blocked') {
      assert.ok(warnings.length > 0, 'blocked providers retain the initiating diagnostic');
      assert.equal(record.runtime, null, 'blocked providers do not claim live execution');
      const trustReason = record.providerId === 'rust-analyzer' ? 'rust_workspace_trust_required'
        : record.providerId === 'sourcekit' ? 'sourcekit_workspace_trust_required' : null;
      if (trustReason && warnings.some(check => check.name === trustReason)) {
        assert.equal(record.preflight.reasonCode, trustReason);
      } else assert.equal(record.preflight.reasonCode, 'preflight_command_unavailable');
    }
    if (record.runtime) {
      for (const field of ['crashesInWindow', 'crashLoopTrips', 'startupFailures', 'handshakeFailures', 'protocolParseFailures', 'requestTimeouts']) {
        if (record.runtime.lifecycle?.[field] != null) assert.equal(record.runtime.lifecycle[field], 0, field);
      }
      if (record.runtime.requests) {
        assert.equal(record.runtime.requests.failed, 0);
        assert.equal(record.runtime.requests.timedOut, 0);
      }
    }
    if (record.providerId === 'pyright') {
      assert.equal(record.fidelity.state, 'healthy', 'the required installed Python provider contributes healthy results');
      assert.ok(record.fidelity.requestClasses.documentSymbol.requests > 0);
      for (const metrics of Object.values(record.fidelity.requestClasses)) {
        assert.equal(metrics.failed, 0);
        assert.equal(metrics.timedOut, 0);
      }
    }
  }
  if (messages) {
    const summaries = messages.filter(message => message.startsWith('[tooling] warning:'));
    assert.equal(summaries.length, degraded.length ? 1 : 0);
    if (degraded.length) {
      assert.ok(summaries[0].startsWith(`[tooling] warning: reduced enrichment for ${degraded.length} provider(s)`));
      for (const value of [...degraded, ...reasons]) assert.ok(summaries[0].includes(value), value);
    }
  }
  return report;
};

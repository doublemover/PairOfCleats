import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { __readToolingCommandProbeEvidenceForTests } from '../../src/index/tooling/command-resolver.js';

// These sample-repository integrations exercise normal provider selection.
// Absent optional compilation context/commands and project-loader trust rejections are expected;
// crashes, timeouts, protocol failures and any other degraded check are not.
const EXPECTED_WARNINGS = new Map([
  ['clangd', new Set(['clangd_command_unavailable', 'clangd_compilation_context', 'clangd_compile_context_request_plan'])],
  ['pyright', new Set()],
  ['sourcekit', new Set(['sourcekit_command_unavailable', 'sourcekit_workspace_trust_required'])],
  ['rust-analyzer', new Set(['rust_workspace_trust_required', 'lsp_command_unavailable'])]
]);

export const assertDefaultToolingDiagnostics = async ({ repoCacheRoot, startedAt, messages = null,
  platform = process.platform }) => {
  // The fixture owns C, C++ and Objective-C sources. The established provider
  // admits Objective-C on Darwin; other hosts intentionally retain C/C++ only.
  const clangdDocuments = platform === 'darwin' ? 3 : 2;
  const filename = path.join(repoCacheRoot, 'tooling-cache', 'diagnostics', 'tooling.json');
  const report = JSON.parse(await fs.readFile(filename, 'utf8'));
  const retained = path.resolve(process.env.PAIROFCLEATS_TEST_LOG_DIR || '.testLogs', `default-tooling-diagnostics-${process.pid}.json`);
  await fs.mkdir(path.dirname(retained), { recursive: true });
  await fs.writeFile(retained, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(path.dirname(retained), `default-tooling-command-probes-${process.pid}.json`),
    JSON.stringify({ scope: 'original in-process outcomes; no diagnostic retries',
      probes: __readToolingCommandProbeEvidenceForTests() }, null, 2) + '\n');
  assert.equal(report.schemaVersion, 1);
  assert.ok(Date.parse(report.generatedAt) >= startedAt, 'provider evidence was written by this build');
  assert.equal(report.truncated, false);
  assert.equal(report.reportedProviderCount, report.providers.length);
  assert.deepEqual(report.providers.map(record => record.providerId).sort(), [...EXPECTED_WARNINGS.keys()].sort(),
    'the real sample exercises all four detected provider routes');
  const degraded = [], reasons = new Set();
  for (const record of report.providers) {
    assert.equal(record.preflight?.timedOut, false);
    assert.ok(['ready', 'blocked'].includes(record.preflight.state), JSON.stringify(record));
    const warnings = record.checks.filter(check => check.status === 'warn');
    if (record.providerId === 'clangd') {
      const contexts = record.checks.filter(check => check.name === 'clangd_compilation_context');
      assert.equal(contexts.length, 1, 'the sample retains its actual compilation-context observation');
      const context = contexts[0];
      // This published surface intentionally projects name/status/message.
      // The selected sample sources have no database, and their virtual paths
      // cannot borrow exact physical compilation authority.
      assert.equal(context.status, 'warn');
      assert.equal(context.message, `clangd compilation database=missing; exact=0/${clangdDocuments}, ambiguous=0, unknown=${clangdDocuments}.`,
        'invalid selection and mixed/exact compilation claims remain unexpected');
      for (const plan of record.checks.filter(check => check.name === 'clangd_compile_context_request_plan')) {
        assert.equal(plan.message, `clangd planned 0 exact and ${clangdDocuments} weak-context documents.`);
      }
    }
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
      // The operator line retains the existing three-item presentation bound;
      // the full asserted cause inventory remains in the saved diagnostic file.
      for (const values of [degraded, [...reasons]]) {
        const sorted = [...values].sort();
        for (const value of sorted.slice(0, 3)) assert.ok(summaries[0].includes(value), value);
        if (sorted.length > 3) assert.ok(summaries[0].includes(`+${sorted.length - 3} more`));
      }
    }
  }
  return report;
};

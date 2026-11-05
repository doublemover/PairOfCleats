import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertDefaultToolingDiagnostics } from '../../helpers/default-tooling-diagnostics.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('default-tooling-diagnostics-platforms');
for (const filename of ['sample.c', 'sample.cpp', 'sample.m']) {
  await fs.access(path.resolve('tests/fixtures/sample/src', filename));
}
const filename = path.join(dir, 'tooling-cache/diagnostics/tooling.json');
await fs.mkdir(path.dirname(filename), { recursive: true });
const blocked = (providerId, name) => ({ providerId,
  preflight: { timedOut: false, state: 'blocked', reasonCode: name }, runtime: null,
  checks: [{ name, status: 'warn', message: 'Expected fixture admission block.' }] });
const reportFor = count => ({ schemaVersion: 1, generatedAt: new Date().toISOString(), truncated: false,
  reportedProviderCount: 4, providers: [
    { ...blocked('clangd', 'clangd_command_unavailable'), preflight: {
      timedOut: false, state: 'blocked', reasonCode: 'preflight_command_unavailable' },
    checks: [{ name: 'clangd_command_unavailable', status: 'warn', message: 'Unavailable command.' },
      { name: 'clangd_compilation_context', status: 'warn',
        message: `clangd compilation database=missing; exact=0/${count}, ambiguous=0, unknown=${count}.` },
      { name: 'clangd_compile_context_request_plan', status: 'warn',
        message: `clangd planned 0 exact and ${count} weak-context documents.` }] },
    blocked('sourcekit', 'sourcekit_workspace_trust_required'),
    blocked('rust-analyzer', 'rust_workspace_trust_required'),
    { providerId: 'pyright', preflight: { timedOut: false, state: 'ready' }, checks: [], runtime: null,
      fidelity: { state: 'healthy', requestClasses: { documentSymbol: { requests: 1, failed: 0, timedOut: 0 } } } }
  ] });
const run = async (report, platform) => {
  await fs.writeFile(filename, JSON.stringify(report));
  return assertDefaultToolingDiagnostics({ repoCacheRoot: dir, startedAt: 0, platform });
};
try {
  for (const platform of ['win32', 'linux', 'darwin']) {
    const count = platform === 'darwin' ? 3 : 2;
    await run(reportFor(count), platform);
    await assert.rejects(run(reportFor(count === 3 ? 2 : 3), platform),
      assert.AssertionError, 'another platform inventory cannot satisfy the exact source-count assertion');
    for (const message of [
      `clangd compilation database=invalid; exact=0/${count}, ambiguous=0, unknown=${count}.`,
      `clangd compilation database=missing; exact=1/${count}, ambiguous=0, unknown=${count - 1}.`,
      `clangd compilation database=missing; exact=0/${count}, ambiguous=1, unknown=${count - 1}.`
    ]) {
      const invalid = reportFor(count); invalid.providers[0].checks[1].message = message;
      await assert.rejects(run(invalid, platform), assert.AssertionError);
    }
    const badPlan = reportFor(count);
    badPlan.providers[0].checks[2].message = `clangd planned 1 exact and ${count - 1} weak-context documents.`;
    await assert.rejects(run(badPlan, platform), assert.AssertionError);
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Default diagnostic controls retain exact per-platform source inventory and reject false compilation authority.');

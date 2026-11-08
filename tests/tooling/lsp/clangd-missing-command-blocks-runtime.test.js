import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSingleSymbolInputs, runDedicatedProviderFixture } from '../../helpers/lsp-provider-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-clangd-missing-'));
try {
  const inputs = buildSingleSymbolInputs({ scenarioName: 'missing-command', virtualPath: 'one.c',
    text: 'int alpha(void) { return 1; }', languageId: 'c', effectiveExt: '.c', symbolName: 'alpha' });
  const result = await runDedicatedProviderFixture({ tempRoot: root, providerId: 'clangd', providerConfigKey: 'clangd',
    providerConfig: { cmd: 'poc-deliberately-missing-clangd-20261020' }, inputs });
  const diagnostics = result.diagnostics.clangd;
  assert.equal(diagnostics.preflight.state, 'blocked', JSON.stringify(diagnostics));
  assert.equal(diagnostics.preflight.reasonCode, 'preflight_command_unavailable');
  assert.ok(diagnostics.checks.some(check => check.name === 'clangd_command_unavailable'));
  assert.ok(!diagnostics.checks.some(check => check.name === 'tooling_initialize_failed'));
  assert.equal(diagnostics.runtime, undefined, 'a missing executable has no runtime attempt');
  assert.equal(result.byChunkUid.size, 0);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Definitely missing clangd is blocked before runtime initialization, retaining its initiating diagnostic');

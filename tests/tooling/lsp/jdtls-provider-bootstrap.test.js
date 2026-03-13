#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo,
  resolveLspFixtureCommand,
  runDedicatedProviderFixture
} from '../../helpers/lsp-provider-fixture.js';
import { withLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = await createLspProviderTempRepo({
  repoRoot: root,
  name: 'jdtls-provider-bootstrap',
  directories: ['src'],
  files: [{ path: 'pom.xml', content: '<project/>' }]
});
const fixtureJdtlsCmd = resolveLspFixtureCommand('jdtls', { repoRoot: root });
const docText = 'class App { int add(int a, int b) { return a + b; } }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'jdtls-bootstrap',
  virtualPath: 'src/App.java',
  text: docText,
  languageId: 'java',
  effectiveExt: '.java',
  symbolName: 'add'
});

await withLspTestPath({ repoRoot: root }, async () => {
  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: 'jdtls',
    providerConfigKey: 'jdtls',
    providerConfig: {
      cmd: fixtureJdtlsCmd,
      lifecycle: {
        restartWindowMs: 2100,
        maxRestartsPerWindow: 5,
        fdPressureBackoffMs: 250
      }
    },
    toolingConfig: {
      lifecycle: {
        lifecycleRestartWindowMs: 60000
      }
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), true, 'expected jdtls provider to enrich Java symbol');
  const providerDiag = result.diagnostics?.jdtls || null;
  assert.ok(providerDiag && providerDiag.runtime, 'expected runtime diagnostics for jdtls provider');
  assert.equal(providerDiag.runtime?.lifecycle?.restartWindowMs, 2100, 'expected provider lifecycle override');
  assert.equal(providerDiag.runtime?.lifecycle?.maxRestartsPerWindow, 5, 'expected provider max restarts');
  assert.equal(providerDiag.runtime?.lifecycle?.fdPressureBackoffMs, 250, 'expected provider fd backoff');
  const checks = Array.isArray(providerDiag?.checks) ? providerDiag.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'jdtls_workspace_model_missing'),
    false,
    'workspace marker guard should not trigger when pom.xml exists'
  );

  console.log('jdtls provider bootstrap test passed');
});

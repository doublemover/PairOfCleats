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
  name: 'jdtls-provider-launch-contract-invalid',
  directories: ['src'],
  files: [{ path: 'pom.xml', content: '<project/>' }]
});
const fixtureJdtlsCmd = resolveLspFixtureCommand('jdtls', { repoRoot: root });
const docText = 'class App { String greet(String name) { return name; } }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'jdtls-launch-contract-invalid',
  virtualPath: 'src/App.java',
  text: docText,
  languageId: 'java',
  effectiveExt: '.java',
  symbolName: 'greet'
});

await withLspTestPath({ repoRoot: root }, async () => {
  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: 'jdtls',
    providerConfigKey: 'jdtls',
    providerConfig: {
      cmd: fixtureJdtlsCmd,
      args: ['-configuration']
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected jdtls provider to be blocked by invalid launch contract');
  const diagnostics = result.diagnostics?.jdtls || {};
  assert.equal(diagnostics?.preflight?.state, 'blocked', 'expected jdtls preflight blocked state');
  assert.equal(
    diagnostics?.preflight?.reasonCode,
    'jdtls_launch_contract_invalid',
    'expected jdtls launch contract invalid reason code'
  );
  const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'jdtls_launch_contract_invalid'),
    true,
    'expected jdtls launch contract invalid warning check'
  );
});

console.log('jdtls provider launch contract invalid test passed');

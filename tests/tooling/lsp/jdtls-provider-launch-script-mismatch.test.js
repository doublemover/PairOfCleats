#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo,
  runDedicatedProviderFixture
} from '../../helpers/lsp-provider-fixture.js';
import { withLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = await createLspProviderTempRepo({
  repoRoot: root,
  name: 'jdtls-provider-launch-script-mismatch',
  directories: ['src'],
  files: [{ path: 'pom.xml', content: '<project/>' }]
});
const docText = 'class App { String greet(String name) { return name; } }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'jdtls-launch-script-mismatch',
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
      cmd: 'java',
      args: ['-Xmx512m']
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected jdtls provider to be blocked by launch script mismatch');
  const diagnostics = result.diagnostics?.jdtls || {};
  assert.equal(diagnostics?.preflight?.state, 'blocked', 'expected jdtls preflight blocked state');
  assert.equal(
    diagnostics?.preflight?.reasonCode,
    'jdtls_launch_script_mismatch',
    'expected jdtls launch-script mismatch reason code'
  );
  const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'jdtls_launch_script_mismatch'),
    true,
    'expected jdtls launch-script mismatch warning check'
  );
});

console.log('jdtls provider launch script mismatch test passed');

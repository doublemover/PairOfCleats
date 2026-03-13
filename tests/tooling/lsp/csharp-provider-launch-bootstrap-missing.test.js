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
  name: 'csharp-provider-launch-bootstrap-missing',
  directories: ['src'],
  files: [{ path: 'sample.sln', content: 'Microsoft Visual Studio Solution File\n' }]
});
const docText = 'class App { string Greet(string name) => name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'csharp-launch-bootstrap-missing',
  virtualPath: 'src/App.cs',
  text: docText,
  languageId: 'csharp',
  effectiveExt: '.cs',
  symbolName: 'Greet'
});

await withLspTestPath({ repoRoot: root }, async () => {
  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: 'csharp-ls',
    providerConfigKey: 'csharp',
    providerConfig: {
      cmd: 'dotnet',
      args: ['tools/csharp-ls.dll']
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected csharp provider to be blocked when dotnet launcher assembly is missing');
  const diagnostics = result.diagnostics?.['csharp-ls'] || {};
  assert.equal(diagnostics?.preflight?.state, 'blocked', 'expected csharp preflight blocked state');
  assert.equal(
    diagnostics?.preflight?.reasonCode,
    'csharp_launch_bootstrap_missing',
    'expected csharp launch bootstrap missing reason code'
  );
  const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'csharp_launch_bootstrap_missing'),
    true,
    'expected csharp launch bootstrap missing warning check'
  );
});

console.log('csharp provider launch bootstrap missing test passed');

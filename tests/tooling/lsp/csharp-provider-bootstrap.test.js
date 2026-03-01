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
  name: 'csharp-provider-bootstrap',
  directories: ['src'],
  files: [{ path: 'App.csproj', content: '<Project/>' }]
});
const fixtureCsharpCmd = resolveLspFixtureCommand('csharp-ls', { repoRoot: root });
const docText = 'class App { string Greet(string name) => name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'csharp-bootstrap',
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
      cmd: fixtureCsharpCmd
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), true, 'expected csharp provider to enrich C# symbol');
  const providerDiag = result.diagnostics?.['csharp-ls'] || null;
  assert.ok(providerDiag && providerDiag.runtime, 'expected runtime diagnostics for csharp provider');
  const checks = Array.isArray(providerDiag?.checks) ? providerDiag.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'csharp_workspace_model_missing'),
    false,
    'workspace marker guard should not trigger when csproj exists'
  );

  console.log('csharp provider bootstrap test passed');
});

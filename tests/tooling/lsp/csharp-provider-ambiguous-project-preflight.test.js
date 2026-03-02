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
  name: 'csharp-provider-ambiguous-project-preflight',
  directories: ['src'],
  files: [
    { path: 'AppA.csproj', content: '<Project/>' },
    { path: 'AppB.csproj', content: '<Project/>' }
  ]
});
const fixtureCsharpCmd = resolveLspFixtureCommand('csharp-ls', { repoRoot: root });
const docText = 'class App { string Greet(string name) => name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'csharp-ambiguous-project-preflight',
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

  assert.equal(result.byChunkUid.has(inputs.chunkUid), true, 'expected csharp provider to continue with ambiguous project roots');
  const diagnostics = result.diagnostics?.['csharp-ls'] || {};
  assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected csharp preflight degraded state');
  assert.equal(
    diagnostics?.preflight?.reasonCode,
    'csharp_workspace_ambiguous_project',
    'expected csharp ambiguous project reason code'
  );
  const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'csharp_workspace_ambiguous_project'),
    true,
    'expected csharp ambiguous project warning check'
  );
});

console.log('csharp provider ambiguous project preflight test passed');

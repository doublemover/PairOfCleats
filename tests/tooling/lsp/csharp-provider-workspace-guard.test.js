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
  name: 'csharp-provider-guard',
  directories: ['src']
});
const docText = 'class App { string Greet(string name) => name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'csharp-guard',
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
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected guard to skip csharp-ls without workspace model');
  const checks = Array.isArray(result.diagnostics?.['csharp-ls']?.checks) ? result.diagnostics['csharp-ls'].checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'csharp_workspace_model_missing'),
    true,
    'expected csharp workspace model guard check'
  );

  console.log('csharp provider workspace guard test passed');
});

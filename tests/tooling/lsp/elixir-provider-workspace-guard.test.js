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
  name: 'elixir-provider-guard',
  directories: ['lib']
});
const docText = 'defmodule Sample do\n  def greet(name), do: name\nend\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'elixir-guard',
  virtualPath: 'lib/sample.ex',
  text: docText,
  languageId: 'elixir',
  effectiveExt: '.ex',
  symbolName: 'greet'
});

await withLspTestPath({ repoRoot: root }, async () => {
  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: 'elixir-ls',
    providerConfigKey: 'elixir',
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected guard to skip elixir-ls without mix.exs');
  const checks = result.diagnostics?.['elixir-ls']?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'elixir_workspace_model_missing'),
    true,
    'expected workspace model missing warning'
  );
});

console.log('elixir provider workspace guard test passed');

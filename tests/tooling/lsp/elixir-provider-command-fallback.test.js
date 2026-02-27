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
  name: 'elixir-provider-command-fallback',
  directories: ['lib'],
  files: [{ path: 'mix.exs', content: 'defmodule Sample.MixProject do\nend\n' }]
});
const docText = 'defmodule Sample do\n  def greet(name), do: name\nend\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'elixir-command-fallback',
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
    providerConfig: {
      cmd: 'elixir-ls-not-found'
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected fail-open fallback when elixir-ls command is unavailable');
  const checks = result.diagnostics?.['elixir-ls']?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'elixir_command_unavailable'),
    true,
    'expected command unavailable warning'
  );
});

console.log('elixir provider command fallback test passed');

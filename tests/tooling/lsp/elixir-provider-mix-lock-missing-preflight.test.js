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
  name: 'elixir-provider-mix-lock-missing-preflight',
  directories: ['lib'],
  files: [{ path: 'mix.exs', content: 'defmodule Sample.MixProject do\nend\n' }]
});
const fixtureElixirCmd = resolveLspFixtureCommand('elixir-ls', { repoRoot: root });
const docText = 'defmodule Sample do\n  def greet(name), do: name\nend\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'elixir-mix-lock-missing-preflight',
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
      cmd: fixtureElixirCmd
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), true, 'expected elixir provider to continue when mix.lock is missing');
  const diagnostics = result.diagnostics?.['elixir-ls'] || {};
  assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected elixir preflight degraded state');
  assert.equal(
    diagnostics?.preflight?.reasonCode,
    'elixir_workspace_mix_lock_missing',
    'expected elixir mix.lock-missing reason code'
  );
  const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'elixir_workspace_mix_lock_missing'),
    true,
    'expected elixir mix.lock-missing warning check'
  );
});

console.log('elixir provider mix.lock missing preflight test passed');

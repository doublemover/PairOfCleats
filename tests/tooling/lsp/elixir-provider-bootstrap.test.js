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
  name: 'elixir-provider-bootstrap',
  directories: ['lib'],
  files: [{ path: 'mix.exs', content: 'defmodule Sample.MixProject do\nend\n' }]
});
const fixtureElixirCmd = resolveLspFixtureCommand('elixir-ls', { repoRoot: root });
const docText = 'defmodule Sample do\n  def greet(name), do: name\nend\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'elixir-bootstrap',
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

  assert.equal(result.byChunkUid.has(inputs.chunkUid), true, 'expected elixir provider to enrich Elixir symbol');
  const hit = result.byChunkUid.get(inputs.chunkUid);
  assert.equal(hit.payload?.returnType, 'String.t()', 'expected parsed Elixir return type');
  assert.equal(hit.payload?.paramTypes?.name?.[0]?.type, 'String.t()', 'expected parsed Elixir param type');
  const providerDiag = result.diagnostics?.['elixir-ls'] || null;
  assert.ok(providerDiag && providerDiag.runtime, 'expected runtime diagnostics for elixir provider');

  console.log('elixir provider bootstrap test passed');
});

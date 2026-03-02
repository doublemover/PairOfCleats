#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo,
  resolveLspFixtureCommand,
  runDedicatedProviderFixture
} from '../../helpers/lsp-provider-fixture.js';
import { withLspTestPath } from '../../helpers/lsp-runtime.js';
import { writeRuntimeCommandFixture } from '../../helpers/runtime-command-fixture.js';

const root = process.cwd();
const tempRoot = await createLspProviderTempRepo({
  repoRoot: root,
  name: 'elixir-provider-runtime-otp-mismatch-preflight',
  directories: ['lib', '.runtime-bin'],
  files: [{ path: 'mix.exs', content: 'defmodule Sample.MixProject do\nend\n' }]
});
const runtimeBinDir = path.join(tempRoot, '.runtime-bin');
await writeRuntimeCommandFixture({
  binDir: runtimeBinDir,
  name: 'elixir',
  stdout: 'Erlang/OTP 26\nElixir 1.16.1 (compiled with Erlang/OTP 26)\n'
});
await writeRuntimeCommandFixture({
  binDir: runtimeBinDir,
  name: 'erl',
  stderr: 'Erlang/OTP 25 [erts-13.0]\n'
});
await writeRuntimeCommandFixture({
  binDir: runtimeBinDir,
  name: 'mix',
  stdout: 'Mix 1.16.1 (compiled with Erlang/OTP 26)\n'
});

const fixtureElixirCmd = resolveLspFixtureCommand('elixir-ls', { repoRoot: root });
const docText = 'defmodule Sample do\n  def greet(name), do: name\nend\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'elixir-runtime-otp-mismatch-preflight',
  virtualPath: 'lib/sample.ex',
  text: docText,
  languageId: 'elixir',
  effectiveExt: '.ex',
  symbolName: 'greet'
});

await withLspTestPath({ repoRoot: root, extraPrepend: [runtimeBinDir] }, async () => {
  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: 'elixir-ls',
    providerConfigKey: 'elixir',
    providerConfig: {
      cmd: fixtureElixirCmd
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), true, 'expected elixir provider to fail-open on OTP mismatch');
  const diagnostics = result.diagnostics?.['elixir-ls'] || {};
  assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected elixir preflight degraded state');
  assert.equal(
    diagnostics?.preflight?.reasonCode,
    'elixir_runtime_otp_mismatch',
    'expected elixir runtime OTP mismatch reason code'
  );
  const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'elixir_runtime_otp_mismatch'),
    true,
    'expected elixir runtime OTP mismatch warning check'
  );
});

console.log('elixir provider runtime OTP mismatch preflight test passed');

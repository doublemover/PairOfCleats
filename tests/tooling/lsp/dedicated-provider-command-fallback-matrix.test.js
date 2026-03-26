#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo,
  runDedicatedProviderFixture
} from '../../helpers/lsp-provider-fixture.js';
import { withLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();

const cases = [
  {
    providerId: 'elixir-ls',
    providerConfigKey: 'elixir',
    fixtureName: 'elixir-provider-command-fallback-matrix',
    directories: ['lib'],
    files: [{ path: 'mix.exs', content: 'defmodule Sample.MixProject do\nend\n' }],
    docText: 'defmodule Sample do\n  def greet(name), do: name\nend\n',
    virtualPath: 'lib/sample.ex',
    languageId: 'elixir',
    effectiveExt: '.ex',
    symbolName: 'greet',
    unavailableCommand: 'elixir-ls-not-found',
    expectedCheckName: 'elixir_command_unavailable'
  },
  {
    providerId: 'haskell-language-server',
    providerConfigKey: 'haskell',
    fixtureName: 'haskell-provider-command-fallback-matrix',
    directories: ['src'],
    files: [{ path: 'stack.yaml', content: 'resolver: lts-22.0\n' }],
    docText: 'greet :: Text -> Text\ngreet name = name\n',
    virtualPath: 'src/Main.hs',
    languageId: 'haskell',
    effectiveExt: '.hs',
    symbolName: 'greet',
    unavailableCommand: 'haskell-language-server-not-found',
    expectedCheckName: 'haskell_command_unavailable'
  },
  {
    providerId: 'phpactor',
    providerConfigKey: 'phpactor',
    fixtureName: 'phpactor-provider-command-fallback-matrix',
    directories: ['src'],
    files: [{ path: 'composer.json', content: '{"name":"fixture/php"}\n' }],
    docText: '<?php\nfunction greet(string $name): string { return $name; }\n',
    virtualPath: 'src/app.php',
    languageId: 'php',
    effectiveExt: '.php',
    symbolName: 'greet',
    unavailableCommand: 'phpactor-not-found',
    expectedCheckName: 'phpactor_command_unavailable'
  },
  {
    providerId: 'solargraph',
    providerConfigKey: 'solargraph',
    fixtureName: 'solargraph-provider-command-fallback-matrix',
    directories: ['lib'],
    files: [{ path: 'Gemfile', content: "source 'https://rubygems.org'\n" }],
    docText: 'def greet(name)\n  name\nend\n',
    virtualPath: 'lib/app.rb',
    languageId: 'ruby',
    effectiveExt: '.rb',
    symbolName: 'greet',
    unavailableCommand: 'solargraph-command-not-found',
    expectedCheckName: 'solargraph_command_unavailable'
  }
];

await withLspTestPath({ repoRoot: root }, async () => {
  for (const entry of cases) {
    const tempRoot = await createLspProviderTempRepo({
      repoRoot: root,
      name: entry.fixtureName,
      directories: entry.directories,
      files: entry.files
    });
    const inputs = buildSingleSymbolInputs({
      scenarioName: entry.fixtureName,
      virtualPath: entry.virtualPath,
      text: entry.docText,
      languageId: entry.languageId,
      effectiveExt: entry.effectiveExt,
      symbolName: entry.symbolName
    });
    const result = await runDedicatedProviderFixture({
      tempRoot,
      providerId: entry.providerId,
      providerConfigKey: entry.providerConfigKey,
      providerConfig: {
        cmd: entry.unavailableCommand
      },
      inputs
    });

    assert.equal(result.byChunkUid.has(inputs.chunkUid), false, `expected fail-open fallback for ${entry.providerId}`);
    const checks = result.diagnostics?.[entry.providerId]?.checks || [];
    assert.equal(
      checks.some((check) => check?.name === entry.expectedCheckName),
      true,
      `expected command unavailable warning for ${entry.providerId}`
    );
  }
});

console.log('dedicated provider command fallback matrix test passed');

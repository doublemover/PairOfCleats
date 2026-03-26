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
    providerId: 'csharp-ls',
    providerConfigKey: 'csharp',
    fixtureName: 'csharp-provider-guard-matrix',
    directories: ['src'],
    docText: 'class App { string Greet(string name) => name; }\n',
    virtualPath: 'src/App.cs',
    languageId: 'csharp',
    effectiveExt: '.cs',
    symbolName: 'Greet',
    expectedCheckName: 'csharp_workspace_model_missing'
  },
  {
    providerId: 'dart',
    providerConfigKey: 'dart',
    fixtureName: 'dart-provider-guard-matrix',
    directories: ['lib'],
    docText: 'String greet(String name) { return name; }\n',
    virtualPath: 'lib/app.dart',
    languageId: 'dart',
    effectiveExt: '.dart',
    symbolName: 'greet',
    expectedCheckName: 'dart_workspace_model_missing'
  },
  {
    providerId: 'elixir-ls',
    providerConfigKey: 'elixir',
    fixtureName: 'elixir-provider-guard-matrix',
    directories: ['lib'],
    docText: 'defmodule Sample do\n  def greet(name), do: name\nend\n',
    virtualPath: 'lib/sample.ex',
    languageId: 'elixir',
    effectiveExt: '.ex',
    symbolName: 'greet',
    expectedCheckName: 'elixir_workspace_model_missing'
  },
  {
    providerId: 'haskell-language-server',
    providerConfigKey: 'haskell',
    fixtureName: 'haskell-provider-guard-matrix',
    directories: ['src'],
    docText: 'greet :: Text -> Text\ngreet name = name\n',
    virtualPath: 'src/Main.hs',
    languageId: 'haskell',
    effectiveExt: '.hs',
    symbolName: 'greet',
    expectedCheckName: 'haskell_workspace_model_missing'
  },
  {
    providerId: 'jdtls',
    providerConfigKey: 'jdtls',
    fixtureName: 'jdtls-provider-guard-matrix',
    directories: ['src'],
    docText: 'class App { int add(int a, int b) { return a + b; } }\n',
    virtualPath: 'src/App.java',
    languageId: 'java',
    effectiveExt: '.java',
    symbolName: 'add',
    expectedCheckName: 'jdtls_workspace_model_missing'
  },
  {
    providerId: 'phpactor',
    providerConfigKey: 'phpactor',
    fixtureName: 'phpactor-provider-guard-matrix',
    directories: ['src'],
    docText: '<?php\nfunction greet(string $name): string { return $name; }\n',
    virtualPath: 'src/app.php',
    languageId: 'php',
    effectiveExt: '.php',
    symbolName: 'greet',
    expectedCheckName: 'phpactor_workspace_model_missing'
  },
  {
    providerId: 'solargraph',
    providerConfigKey: 'solargraph',
    fixtureName: 'solargraph-provider-guard-matrix',
    directories: ['lib'],
    docText: 'def greet(name)\n  name\nend\n',
    virtualPath: 'lib/app.rb',
    languageId: 'ruby',
    effectiveExt: '.rb',
    symbolName: 'greet',
    expectedCheckName: 'solargraph_workspace_model_missing'
  }
];

await withLspTestPath({ repoRoot: root }, async () => {
  for (const entry of cases) {
    const tempRoot = await createLspProviderTempRepo({
      repoRoot: root,
      name: entry.fixtureName,
      directories: entry.directories
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
      inputs
    });

    assert.equal(result.byChunkUid.has(inputs.chunkUid), false, `expected workspace guard to skip ${entry.providerId}`);
    const checks = Array.isArray(result.diagnostics?.[entry.providerId]?.checks)
      ? result.diagnostics[entry.providerId].checks
      : [];
    assert.equal(
      checks.some((check) => check?.name === entry.expectedCheckName),
      true,
      `expected workspace model guard check for ${entry.providerId}`
    );
  }
});

console.log('dedicated provider workspace guard matrix test passed');

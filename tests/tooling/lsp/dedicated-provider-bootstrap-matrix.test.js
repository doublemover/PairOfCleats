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

const cases = [
  {
    providerId: 'csharp-ls',
    providerConfigKey: 'csharp',
    fixtureName: 'csharp-provider-bootstrap-matrix',
    fixtureCommand: 'csharp-ls',
    directories: ['src'],
    files: [{ path: 'App.csproj', content: '<Project/>' }],
    docText: 'class App { string Greet(string name) => name; }\n',
    virtualPath: 'src/App.cs',
    languageId: 'csharp',
    effectiveExt: '.cs',
    symbolName: 'Greet',
    assertPayload: (payload) => {
      assert.equal(payload?.returnType, 'string', 'expected parsed C# return type');
      assert.equal(payload?.paramTypes?.name?.[0]?.type, 'string', 'expected parsed C# param type');
    }
  },
  {
    providerId: 'dart',
    providerConfigKey: 'dart',
    fixtureName: 'dart-provider-bootstrap-matrix',
    fixtureCommand: 'dart',
    directories: ['lib'],
    files: [{ path: 'pubspec.yaml', content: 'name: dart_fixture\n' }],
    docText: 'String greet(String name) { return name; }\n',
    virtualPath: 'lib/app.dart',
    languageId: 'dart',
    effectiveExt: '.dart',
    symbolName: 'greet',
    assertPayload: (payload) => {
      assert.equal(payload?.returnType, 'String', 'expected parsed Dart return type');
      assert.equal(payload?.paramTypes?.name?.[0]?.type, 'String', 'expected parsed Dart param type');
    }
  },
  {
    providerId: 'elixir-ls',
    providerConfigKey: 'elixir',
    fixtureName: 'elixir-provider-bootstrap-matrix',
    fixtureCommand: 'elixir-ls',
    directories: ['lib'],
    files: [{ path: 'mix.exs', content: 'defmodule Sample.MixProject do\nend\n' }],
    docText: 'defmodule Sample do\n  def greet(name), do: name\nend\n',
    virtualPath: 'lib/sample.ex',
    languageId: 'elixir',
    effectiveExt: '.ex',
    symbolName: 'greet',
    assertPayload: (payload) => {
      assert.equal(payload?.returnType, 'String.t()', 'expected parsed Elixir return type');
      assert.equal(payload?.paramTypes?.name?.[0]?.type, 'String.t()', 'expected parsed Elixir param type');
    }
  },
  {
    providerId: 'haskell-language-server',
    providerConfigKey: 'haskell',
    fixtureName: 'haskell-provider-bootstrap-matrix',
    fixtureCommand: 'haskell-language-server',
    directories: ['src'],
    files: [{ path: 'stack.yaml', content: 'resolver: lts-22.0\n' }],
    docText: 'greet :: Text -> Text\ngreet name = name\n',
    virtualPath: 'src/Main.hs',
    languageId: 'haskell',
    effectiveExt: '.hs',
    symbolName: 'greet',
    assertPayload: (payload) => {
      assert.equal(payload?.returnType, 'Text', 'expected parsed Haskell return type');
      assert.equal(payload?.paramTypes?.arg1?.[0]?.type, 'Text', 'expected parsed Haskell param type');
    }
  },
  {
    providerId: 'phpactor',
    providerConfigKey: 'phpactor',
    fixtureName: 'phpactor-provider-bootstrap-matrix',
    fixtureCommand: 'phpactor',
    directories: ['src'],
    files: [{ path: 'composer.json', content: '{"name":"fixture/php"}\n' }],
    docText: '<?php\nfunction greet(string $name): string { return $name; }\n',
    virtualPath: 'src/app.php',
    languageId: 'php',
    effectiveExt: '.php',
    symbolName: 'greet',
    assertPayload: (payload) => {
      assert.equal(payload?.returnType, 'string', 'expected parsed PHP return type');
      assert.equal(payload?.paramTypes?.name?.[0]?.type, 'string', 'expected parsed PHP param type');
    }
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
        cmd: resolveLspFixtureCommand(entry.fixtureCommand, { repoRoot: root })
      },
      inputs
    });

    assert.equal(result.byChunkUid.has(inputs.chunkUid), true, `expected ${entry.providerId} to enrich its symbol`);
    const hit = result.byChunkUid.get(inputs.chunkUid);
    entry.assertPayload(hit?.payload);
    const providerDiag = result.diagnostics?.[entry.providerId] || null;
    assert.ok(providerDiag && providerDiag.runtime, `expected runtime diagnostics for ${entry.providerId}`);
  }
});

console.log('dedicated provider bootstrap matrix test passed');

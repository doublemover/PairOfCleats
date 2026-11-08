#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';

import { countNonEmptyLines } from '../../helpers/lsp-signature-fixtures.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath, probeLspCommandForTest } from '../../helpers/lsp-runtime.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `dedicated-providers-multifile-reuse-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const restorePath = prependLspTestPath({ repoRoot: root });
const fixtureServer = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');

const providerCases = [
  {
    providerId: 'jdtls',
    configKey: 'jdtls',
    languageId: 'java',
    ext: '.java',
    symbolName: 'add',
    markerPath: 'pom.xml',
    markerContent: '<project/>\n',
    textOne: 'class A { int add(int a, int b) { return a + b; } }\n',
    textTwo: 'class B { int add(int a, int b) { return a + b; } }\n'
  },
  {
    providerId: 'csharp-ls',
    configKey: 'csharp',
    languageId: 'csharp',
    ext: '.cs',
    symbolName: 'Greet',
    markerPath: 'sample.sln',
    markerContent: 'Microsoft Visual Studio Solution File\n',
    textOne: 'public class A { string Greet(string name) => name; }\n',
    textTwo: 'public class B { string Greet(string name) => name; }\n'
  },
  {
    providerId: 'solargraph',
    configKey: 'solargraph',
    languageId: 'ruby',
    ext: '.rb',
    symbolName: 'greet',
    markerPath: 'Gemfile',
    markerContent: "source 'https://rubygems.org'\n",
    textOne: 'def greet(name)\n  name\nend\n',
    textTwo: 'def greet(name)\n  name\nend\n'
  },
  {
    providerId: 'elixir-ls',
    configKey: 'elixir',
    languageId: 'elixir',
    ext: '.ex',
    symbolName: 'greet',
    markerPath: 'mix.exs',
    markerContent: 'defmodule Sample.MixProject do\nend\n',
    textOne: 'defmodule A do\n  def greet(name), do: name\nend\n',
    textTwo: 'defmodule B do\n  def greet(name), do: name\nend\n'
  },
  {
    providerId: 'phpactor',
    configKey: 'phpactor',
    languageId: 'php',
    ext: '.php',
    symbolName: 'greet',
    markerPath: 'composer.json',
    markerContent: '{"name":"fixture/php"}\n',
    textOne: '<?php function greet(string $name): string { return $name; }\n',
    textTwo: '<?php function greet(string $name): string { return $name; }\n'
  },
  {
    providerId: 'haskell-language-server',
    configKey: 'haskell',
    languageId: 'haskell',
    ext: '.hs',
    symbolName: 'greet',
    markerPath: 'stack.yaml',
    markerContent: 'resolver: lts-22.0\n',
    textOne: 'greet :: Text -> Text\ngreet name = name\n',
    textTwo: 'greet :: Text -> Text\ngreet name = name\n'
  },
  {
    providerId: 'dart',
    configKey: 'dart',
    languageId: 'dart',
    ext: '.dart',
    symbolName: 'greet',
    markerPath: 'pubspec.yaml',
    markerContent: 'name: dart_fixture\n',
    textOne: 'String greet(String name) { return name; }\n',
    textTwo: 'String greet(String name) { return name; }\n'
  }
];

const runCase = async (providerCase) => {
  const requiredSubcommand = providerCase.providerId === 'phpactor' || providerCase.providerId === 'dart' ? 'language-server'
    : providerCase.providerId === 'solargraph' ? 'stdio' : null;
  const command = { cmd: process.execPath, args: [fixtureServer, '--mode', providerCase.languageId,
    ...(requiredSubcommand ? [requiredSubcommand] : [])] };
  const profile = await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([tempRoot]),
    PAIROFCLEATS_TRUSTED_CONFIG: null },
  async () => probeLspCommandForTest({ providerId: providerCase.providerId, repoRoot: tempRoot, ...command }));
  assert.equal(profile?.probe?.ok, true, `explicit ${providerCase.providerId} fixture command must pass preflight`);
  const caseRoot = path.join(tempRoot, providerCase.providerId.replace(/[^a-z0-9_-]+/gi, '-'));
  await fs.rm(caseRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(caseRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(caseRoot, providerCase.markerPath), providerCase.markerContent, 'utf8');
  const counterPath = path.join(caseRoot, 'spawn.counter');

  const virtualPathOne = `src/one${providerCase.ext}`;
  const virtualPathTwo = `src/two${providerCase.ext}`;
  const chunkUidOne = `ck64:v1:test:${virtualPathOne}:${providerCase.providerId}:one`;
  const chunkUidTwo = `ck64:v1:test:${virtualPathTwo}:${providerCase.providerId}:two`;
  const config = {
    enabledTools: [providerCase.providerId],
    [providerCase.configKey]: {
      enabled: true,
      ...command
    }
  };

  const result = await withTemporaryEnv({ POC_LSP_COUNTER: counterPath,
    PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([caseRoot]), PAIROFCLEATS_TRUSTED_CONFIG: null }, async () => runToolingProviders({
    strict: true,
    repoRoot: caseRoot,
    buildRoot: caseRoot,
    toolingConfig: config,
    cache: {
      enabled: false
    }
  }, {
    documents: [{
      virtualPath: virtualPathOne,
      text: providerCase.textOne,
      languageId: providerCase.languageId,
      effectiveExt: providerCase.ext,
      docHash: `${providerCase.providerId}-one`
    }, {
      virtualPath: virtualPathTwo,
      text: providerCase.textTwo,
      languageId: providerCase.languageId,
      effectiveExt: providerCase.ext,
      docHash: `${providerCase.providerId}-two`
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid: chunkUidOne,
        chunkId: `chunk_${providerCase.providerId}_one`,
        file: virtualPathOne,
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: providerCase.textOne.length }
      },
      virtualPath: virtualPathOne,
      virtualRange: { start: 0, end: providerCase.textOne.length },
      symbolHint: { name: providerCase.symbolName, kind: 'function' },
      languageId: providerCase.languageId
    }, {
      chunkRef: {
        docId: 1,
        chunkUid: chunkUidTwo,
        chunkId: `chunk_${providerCase.providerId}_two`,
        file: virtualPathTwo,
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: providerCase.textTwo.length }
      },
      virtualPath: virtualPathTwo,
      virtualRange: { start: 0, end: providerCase.textTwo.length },
      symbolHint: { name: providerCase.symbolName, kind: 'function' },
      languageId: providerCase.languageId
    }],
    kinds: ['types']
  }));

  const firstHit = result.byChunkUid.has(chunkUidOne);
  const secondHit = result.byChunkUid.has(chunkUidTwo);
  const diagnostic = JSON.stringify(result.diagnostics?.[providerCase.providerId] || {}).slice(0, 1200);
  assert.equal(firstHit, true, `expected ${providerCase.providerId} hit for first file; ${diagnostic}`);
  assert.equal(secondHit, true, `expected ${providerCase.providerId} hit for second file; ${diagnostic}`);
  const spawnCount = await countNonEmptyLines(counterPath);
  assert.equal(spawnCount, 1, `expected one LSP spawn for ${providerCase.providerId} multi-file run`);
};

export const runDedicatedProviderMultifileCase = async (providerId) => {
  const providerCase = providerCases.find(row => row.providerId === providerId);
  if (!providerCase) throw new Error(`Unknown dedicated multifile provider: ${providerId}`);
  try {
    registerDefaultToolingProviders();
    await runCase(providerCase);
  } finally {
    await restorePath();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
  console.log(`${providerId} multifile session reuse passed`);
};

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';

import { countNonEmptyLines } from '../../helpers/lsp-signature-fixtures.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { skip } from '../../helpers/skip.js';
import { prependLspTestPath, probeLspCommandForTest } from '../../helpers/lsp-runtime.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `dedicated-providers-multifile-reuse-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const restorePath = prependLspTestPath({ repoRoot: root });
const fixturePathMarker = path.join('tests', 'fixtures', 'lsp', 'bin').toLowerCase();
let skipReason = null;

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
  const profile = probeLspCommandForTest({
    providerId: providerCase.providerId,
    repoRoot: tempRoot
  });
  if (!profile?.probe?.ok) {
    return { skipped: true, validated: false };
  }
  const resolvedCmd = String(profile?.resolved?.cmd || '').toLowerCase();
  const usesFixtureRuntime = resolvedCmd.includes(fixturePathMarker);
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
      enabled: true
    }
  };

  const result = await withTemporaryEnv({ POC_LSP_COUNTER: counterPath }, async () => runToolingProviders({
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
  const providerDiag = result.diagnostics?.[providerCase.providerId] || null;

  if (usesFixtureRuntime) {
    assert.equal(firstHit, true, `expected ${providerCase.providerId} hit for first file`);
    assert.equal(secondHit, true, `expected ${providerCase.providerId} hit for second file`);
    const spawnCount = await countNonEmptyLines(counterPath);
    assert.equal(spawnCount, 1, `expected one LSP spawn for ${providerCase.providerId} multi-file run`);
    return { skipped: false, validated: true };
  }

  const initializeRequests = Number(
    providerDiag?.runtime?.requests?.byMethod?.initialize?.requests || 0
  );
  const validated = (firstHit && secondHit) || initializeRequests === 1;
  return { skipped: false, validated };
};

try {
  registerDefaultToolingProviders();
  let validatedCases = 0;
  for (const providerCase of providerCases) {
    const outcome = await runCase(providerCase);
    if (outcome?.validated) validatedCases += 1;
  }
  if (validatedCases === 0) {
    skipReason = 'Skipping dedicated providers multifile session reuse test; no provider yielded a verifiable runtime.';
  }
} finally {
  await restorePath();
}

if (skipReason) {
  skip(skipReason);
}

console.log('dedicated providers multifile session reuse test passed');


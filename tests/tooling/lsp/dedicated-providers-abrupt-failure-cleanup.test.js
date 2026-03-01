#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo,
  runDedicatedProviderFixture
} from '../../helpers/lsp-provider-fixture.js';
import { cleanupLspTestRuntime } from '../../helpers/lsp-runtime.js';
import { getTrackedSubprocessCount } from '../../../src/shared/subprocess.js';

const root = process.cwd();
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');

const providerCases = [
  {
    providerId: 'jdtls',
    configKey: 'jdtls',
    languageId: 'java',
    ext: '.java',
    markerPath: 'pom.xml',
    markerContent: '<project/>\n',
    symbolName: 'add',
    text: 'class Example { int add(int a, int b) { return a + b; } }\n'
  },
  {
    providerId: 'elixir-ls',
    configKey: 'elixir',
    languageId: 'elixir',
    ext: '.ex',
    markerPath: 'mix.exs',
    markerContent: 'defmodule Sample.MixProject do\nend\n',
    symbolName: 'greet',
    text: 'defmodule Example do\n  def greet(name), do: name\nend\n'
  },
  {
    providerId: 'solargraph',
    configKey: 'solargraph',
    languageId: 'ruby',
    ext: '.rb',
    markerPath: 'Gemfile',
    markerContent: "source 'https://rubygems.org'\n",
    symbolName: 'greet',
    text: 'def greet(name)\n  name\nend\n'
  },
  {
    providerId: 'phpactor',
    configKey: 'phpactor',
    languageId: 'php',
    ext: '.php',
    markerPath: 'composer.json',
    markerContent: '{"name":"fixture/php"}\n',
    symbolName: 'greet',
    text: '<?php function greet(string $name): string { return $name; }\n'
  }
];

const checkNames = (result, providerId) => new Set(
  (result?.diagnostics?.[providerId]?.checks || [])
    .map((check) => String(check?.name || '').trim())
    .filter(Boolean)
);

const waitForNoTrackedSubprocesses = async (timeoutMs = 2000) => {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    if (getTrackedSubprocessCount() === 0) return true;
    await sleep(50);
  }
  return getTrackedSubprocessCount() === 0;
};

const runTimeoutScenario = async (providerCase) => {
  const tempRoot = await createLspProviderTempRepo({
    repoRoot: root,
    name: `dedicated-provider-timeout-cleanup-${providerCase.providerId}-${Date.now()}`,
    directories: ['src'],
    files: [
      {
        path: providerCase.markerPath,
        content: providerCase.markerContent
      }
    ]
  });
  const virtualPath = `src/main${providerCase.ext}`;
  const inputs = buildSingleSymbolInputs({
    scenarioName: `dedicated-timeout-${providerCase.providerId}`,
    virtualPath,
    text: providerCase.text,
    languageId: providerCase.languageId,
    effectiveExt: providerCase.ext,
    symbolName: providerCase.symbolName
  });
  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: providerCase.providerId,
    providerConfigKey: providerCase.configKey,
    providerConfig: {
      enabled: true,
      cmd: process.execPath,
      args: [serverPath, '--mode', 'stall-initialize'],
      timeoutMs: 300,
      retries: 0,
      breakerThreshold: 1
    },
    inputs
  });
  assert.equal(result.byChunkUid.size, 0, `expected no enriched symbols for timeout scenario (${providerCase.providerId})`);
  const names = checkNames(result, providerCase.providerId);
  const hasTimeoutOrInitFailure = names.has('tooling_initialize_failed')
    || names.has(`${providerCase.providerId}_provider_execution_failed`);
  assert.equal(
    hasTimeoutOrInitFailure,
    true,
    `expected initialize/provider failure check for timeout scenario (${providerCase.providerId})`
  );
};

const runAbortScenario = async (providerCase) => {
  const tempRoot = await createLspProviderTempRepo({
    repoRoot: root,
    name: `dedicated-provider-abort-cleanup-${providerCase.providerId}-${Date.now()}`,
    directories: ['src'],
    files: [
      {
        path: providerCase.markerPath,
        content: providerCase.markerContent
      }
    ]
  });
  const virtualPath = `src/main${providerCase.ext}`;
  const inputs = buildSingleSymbolInputs({
    scenarioName: `dedicated-abort-${providerCase.providerId}`,
    virtualPath,
    text: providerCase.text,
    languageId: providerCase.languageId,
    effectiveExt: providerCase.ext,
    symbolName: providerCase.symbolName
  });
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 60);
  try {
    const result = await runDedicatedProviderFixture({
      tempRoot,
      providerId: providerCase.providerId,
      providerConfigKey: providerCase.configKey,
      providerConfig: {
        enabled: true,
        cmd: process.execPath,
        args: [serverPath, '--mode', 'stall-initialize'],
        timeoutMs: 1000,
        retries: 0,
        breakerThreshold: 1
      },
      inputs,
      ctxOverrides: {
        abortSignal: controller.signal
      }
    });
    assert.equal(result.byChunkUid.size, 0, `expected no enriched symbols for abort scenario (${providerCase.providerId})`);
    const names = checkNames(result, providerCase.providerId);
    const hasAbortOrInitFailure = names.has('tooling_initialize_failed')
      || names.has(`${providerCase.providerId}_provider_execution_failed`);
    assert.equal(
      hasAbortOrInitFailure,
      true,
      `expected initialize/provider failure check for abort scenario (${providerCase.providerId})`
    );
  } finally {
    clearTimeout(abortTimer);
  }
};

for (const providerCase of providerCases) {
  await runTimeoutScenario(providerCase);
  await runAbortScenario(providerCase);
}

const noTracked = await waitForNoTrackedSubprocesses();
assert.equal(noTracked, true, 'expected dedicated provider abrupt-failure scenarios to leave no tracked subprocesses');
const cleanupSummary = await cleanupLspTestRuntime({
  reason: 'dedicated_provider_abrupt_failure_cleanup',
  strict: true
});
assert.equal(
  Number(cleanupSummary?.trackedCleanup?.attempted || 0),
  0,
  'expected no residual tracked subprocess reaping after dedicated-provider abrupt-failure scenarios'
);

console.log('dedicated providers abrupt-failure cleanup test passed');

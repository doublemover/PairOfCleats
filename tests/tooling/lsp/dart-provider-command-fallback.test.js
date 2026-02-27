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
  name: 'dart-provider-command-fallback',
  directories: ['lib'],
  files: [{ path: 'pubspec.yaml', content: 'name: dart_fixture\n' }]
});
const docText = 'String greet(String name) { return name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'dart-command-fallback',
  virtualPath: 'lib/app.dart',
  text: docText,
  languageId: 'dart',
  effectiveExt: '.dart',
  symbolName: 'greet'
});

await withLspTestPath({ repoRoot: root }, async () => {
  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: 'dart',
    providerConfigKey: 'dart',
    providerConfig: {
      cmd: 'dart-not-found'
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected fail-open fallback when dart command is unavailable');
  const checks = result.diagnostics?.dart?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'dart_command_unavailable'),
    true,
    'expected command unavailable warning'
  );
  assert.equal(
    Array.isArray(result.degradedProviders)
    && result.degradedProviders.some((entry) => entry?.providerId === 'dart'),
    true,
    'expected degraded provider summary entry for dart'
  );
  assert.equal(
    Array.isArray(result.observations)
    && result.observations.some((entry) => entry?.code === 'tooling_provider_degraded_mode' && entry?.context?.providerId === 'dart'),
    true,
    'expected degraded mode observation for dart'
  );
  assert.equal(result.metrics?.degradedProviderCount, 1, 'expected degraded provider metrics count');
  assert.equal(result.metrics?.degradedWarningChecks >= 1, true, 'expected degraded warning metrics');
  assert.equal(result.metrics?.providersContributed, 0, 'expected no chunk contribution in degraded fail-open mode');
  assert.equal(result.metrics?.providerRuntime?.dart?.degraded?.active, true, 'expected per-provider degraded runtime flag');
  assert.equal(result.metrics?.requests?.requests, 0, 'expected no LSP requests when command probe fails early');
});

console.log('dart provider command fallback test passed');

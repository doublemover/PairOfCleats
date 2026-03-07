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
  name: 'dart-provider-package-config-missing-preflight',
  directories: ['lib'],
  files: [{ path: 'pubspec.yaml', content: 'name: dart_fixture\n' }]
});
const fixtureDartCmd = resolveLspFixtureCommand('dart', { repoRoot: root });
const docText = 'String greet(String name) { return name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'dart-package-config-missing-preflight',
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
      cmd: fixtureDartCmd
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), true, 'expected dart provider to fail-open on missing package_config');
  const diagnostics = result.diagnostics?.dart || {};
  assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected dart preflight degraded state');
  assert.equal(
    diagnostics?.preflight?.reasonCode,
    'dart_workspace_package_config_missing',
    'expected dart package-config missing reason code'
  );
  const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'dart_workspace_package_config_missing'),
    true,
    'expected dart package-config missing warning check'
  );
});

console.log('dart provider package config missing preflight test passed');

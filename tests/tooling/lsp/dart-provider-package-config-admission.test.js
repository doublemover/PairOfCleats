import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDartPackageConfig, resolveDartPackageConfigPreflight } from '../../../src/index/tooling/preflight/dart-package-config.js';
import { createDartProvider } from '../../../src/index/tooling/dart-provider.js';
import { buildSingleSymbolInputs, createLspProviderTempRepo, resolveLspFixtureCommand,
  runDedicatedProviderFixture } from '../../helpers/lsp-provider-fixture.js';
import { cleanupLspTestRuntime } from '../../helpers/lsp-runtime.js';

const repoRoot = await createLspProviderTempRepo({ name: 'dart-package-config-admission', files: [
  { path: 'packages/app/pubspec.yaml', content: 'name: app\n' },
  { path: 'packages/app/lib/app.dart', content: 'String greet(String name) => name;\n' }
] });
const filename = path.join(repoRoot, 'packages/app/.dart_tool/package_config.json');
const packageEntry = { name: 'app', rootUri: '../', packageUri: 'lib/', languageVersion: '3.13' };
const config = (packages = [packageEntry]) => ({ configVersion: 2, packages });
const inputs = buildSingleSymbolInputs({ scenarioName: 'dart-config-admission', virtualPath: 'packages/app/lib/app.dart',
  languageId: 'dart', effectiveExt: '.dart', symbolName: 'greet', text: 'String greet(String name) => name;\n' });
const run = () => runDedicatedProviderFixture({ tempRoot: repoRoot, providerId: 'dart', providerConfigKey: 'dart', inputs,
  providerConfig: { cmd: resolveLspFixtureCommand('dart'), args: [],
    timeoutMs: 2000, retries: 0, hoverEnabled: false, definitionEnabled: false, typeDefinitionEnabled: false, referencesEnabled: false } });
try {
  assert.equal(createDartProvider().profileContractVersion, 1, 'unobserved dependency closure cannot authorize durable provider-cache replay');
  assert.throws(() => parseDartPackageConfig({ configVersion: 3, packages: [] }, filename), {
    code: 'ERR_DART_PACKAGE_CONFIG_UNSUPPORTED_VERSION'
  });
  for (const value of [null, [], { packages: [] }, config([{}]),
    config([{ ...packageEntry, name: '..' }]), config([packageEntry, packageEntry]),
    config([{ ...packageEntry, rootUri: '../?query=1' }]), config([{ ...packageEntry, rootUri: '../#fragment' }]),
    config([{ ...packageEntry, rootUri: '%bad' }]), config([{ ...packageEntry, packageUri: '../outside/' }]),
    config([{ ...packageEntry, packageUri: 'https://example.invalid/' }]),
    config([{ ...packageEntry, packageUri: null }]),
    config([{ ...packageEntry, languageVersion: '03.13' }]), config([{ ...packageEntry, languageVersion: 3.13 }]),
    config([packageEntry, { name: 'nested', rootUri: '../lib/nested/' }]),
    config([packageEntry, { name: 'nested', rootUri: '../%6cib/nested/' }])]) {
    assert.throws(() => parseDartPackageConfig(value, filename), { code: 'ERR_DART_PACKAGE_CONFIG_INVALID' });
  }
  const unicode = parseDartPackageConfig(config([{ ...packageEntry, rootUri: '../d%C3%A9p%20space/' }]), filename);
  assert.match(unicode[0].rootUri, /d%C3%A9p%20space/u);
  assert.equal(parseDartPackageConfig(config([packageEntry, { name: 'separate', rootUri: '../test/' }]), filename).length, 2,
    'nested packages outside the parent package URI are valid');
  const ctx = { repoRoot };
  const missing = await resolveDartPackageConfigPreflight({ ctx, inputs });
  assert.equal(missing.reasonCode, 'dart_workspace_package_config_missing', 'nearest nested pubspec must be checked');
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, JSON.stringify(config([{}])));
  const invalidResult = await run();
  assert.equal(invalidResult.diagnostics.dart.preflight.reasonCode, 'dart_workspace_package_config_invalid');
  assert.ok(invalidResult.byChunkUid.has(inputs.chunkUid), 'invalid context remains explicitly degraded while presentation evidence survives');
  await fs.writeFile(filename, JSON.stringify(config()));
  const ready = await resolveDartPackageConfigPreflight({ ctx, inputs });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.packageModels[0].workspace, 'packages/app');
  assert.equal(ready.packageModels[0].dependencyClosure, 'unknown');
  const validResult = await run();
  const retained = validResult.diagnostics.dart.checks.find(check => check.name === 'dart_workspace_package_model');
  assert.equal(retained.details.packageConfigHash, ready.packageModels[0].packageConfigHash,
    'observed model digest reaches actual provider diagnostics');
  assert.equal(retained.details.dependencyClosure, 'unknown');
  await fs.writeFile(filename, JSON.stringify(config([{ ...packageEntry, languageVersion: '3.12' }])));
  const changed = await resolveDartPackageConfigPreflight({ ctx, inputs });
  assert.notEqual(changed.packageModels[0].packageConfigHash, ready.packageModels[0].packageConfigHash,
    'language-version-only changes retain distinct observed package models');
  await fs.writeFile(filename, JSON.stringify(config([{ ...packageEntry, rootUri: '../absent/' }])));
  assert.equal((await resolveDartPackageConfigPreflight({ ctx, inputs })).reasonCode, 'dart_workspace_package_config_unresolved');
  await fs.writeFile(filename, JSON.stringify(config([{ ...packageEntry, rootUri: pathToFileURL(path.dirname(repoRoot)).href }])));
  assert.deepEqual((await resolveDartPackageConfigPreflight({ ctx, inputs })).packageModels[0].externalRootsUnobserved, ['app']);
  await fs.writeFile(filename, JSON.stringify(config([{ ...packageEntry, rootUri: 'https://example.invalid/package/' }])));
  const blocked = await run();
  assert.equal(blocked.diagnostics.dart.preflight.state, 'blocked');
  assert.equal(blocked.byChunkUid.size, 0, 'offline package-model denial must prevent server launch');
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(resolveDartPackageConfigPreflight({ ctx, inputs, abortSignal: cancelled.signal }), { name: 'AbortError' });
} finally {
  await cleanupLspTestRuntime({ reason: 'dart_package_config_admission', strict: true });
  await fs.rm(repoRoot, { recursive: true, force: true });
}
console.log('Dart nested package-model admission preserves URI ownership, invalidity and offline boundaries');

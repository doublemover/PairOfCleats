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
  name: 'dart-provider-bootstrap',
  directories: ['lib'],
  files: [{ path: 'pubspec.yaml', content: 'name: dart_fixture\n' }]
});
const fixtureDartCmd = resolveLspFixtureCommand('dart', { repoRoot: root });
const docText = 'String greet(String name) { return name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'dart-bootstrap',
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

  assert.equal(result.byChunkUid.has(inputs.chunkUid), true, 'expected dart provider to enrich Dart symbol');
  const hit = result.byChunkUid.get(inputs.chunkUid);
  assert.equal(hit.payload?.returnType, 'String', 'expected parsed Dart return type');
  assert.equal(hit.payload?.paramTypes?.name?.[0]?.type, 'String', 'expected parsed Dart param type');
  const providerDiag = result.diagnostics?.dart || null;
  assert.ok(providerDiag && providerDiag.runtime, 'expected runtime diagnostics for dart provider');

  console.log('dart provider bootstrap test passed');
});

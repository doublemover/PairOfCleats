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
  name: 'dart-provider-guard',
  directories: ['lib']
});
const docText = 'String greet(String name) { return name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'dart-guard',
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
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected guard to skip dart provider without pubspec.yaml');
  const checks = result.diagnostics?.dart?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'dart_workspace_model_missing'),
    true,
    'expected workspace model missing warning'
  );

  console.log('dart provider workspace guard test passed');
});

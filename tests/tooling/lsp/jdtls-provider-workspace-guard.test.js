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
  name: 'jdtls-provider-guard',
  directories: ['src']
});
const docText = 'class App { int add(int a, int b) { return a + b; } }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'jdtls-guard',
  virtualPath: 'src/App.java',
  text: docText,
  languageId: 'java',
  effectiveExt: '.java',
  symbolName: 'add'
});

await withLspTestPath({ repoRoot: root }, async () => {
  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: 'jdtls',
    providerConfigKey: 'jdtls',
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected guard to skip jdtls provider without workspace model');
  const checks = result.diagnostics?.jdtls?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'jdtls_workspace_model_missing'),
    true,
    'expected workspace model missing warning'
  );
});

console.log('jdtls provider workspace guard test passed');

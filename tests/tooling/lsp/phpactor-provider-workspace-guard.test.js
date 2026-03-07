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
  name: 'phpactor-provider-guard',
  directories: ['src']
});
const docText = '<?php\nfunction greet(string $name): string { return $name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'phpactor-guard',
  virtualPath: 'src/app.php',
  text: docText,
  languageId: 'php',
  effectiveExt: '.php',
  symbolName: 'greet'
});

await withLspTestPath({ repoRoot: root }, async () => {
  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: 'phpactor',
    providerConfigKey: 'phpactor',
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected guard to skip phpactor without composer.json');
  const checks = result.diagnostics?.phpactor?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'phpactor_workspace_model_missing'),
    true,
    'expected workspace model missing warning'
  );
});

console.log('phpactor provider workspace guard test passed');

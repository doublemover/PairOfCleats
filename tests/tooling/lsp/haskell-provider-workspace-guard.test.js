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
  name: 'haskell-provider-guard',
  directories: ['src']
});
const docText = 'greet :: Text -> Text\ngreet name = name\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'haskell-guard',
  virtualPath: 'src/Main.hs',
  text: docText,
  languageId: 'haskell',
  effectiveExt: '.hs',
  symbolName: 'greet'
});

await withLspTestPath({ repoRoot: root }, async () => {
  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: 'haskell-language-server',
    providerConfigKey: 'haskell',
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected guard to skip haskell provider without workspace model');
  const checks = result.diagnostics?.['haskell-language-server']?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'haskell_workspace_model_missing'),
    true,
    'expected workspace model missing warning'
  );
});

console.log('haskell provider workspace guard test passed');

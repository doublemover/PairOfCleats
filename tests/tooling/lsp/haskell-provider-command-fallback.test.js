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
  name: 'haskell-provider-command-fallback',
  directories: ['src'],
  files: [{ path: 'stack.yaml', content: 'resolver: lts-22.0\n' }]
});
const docText = 'greet :: Text -> Text\ngreet name = name\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'haskell-command-fallback',
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
    providerConfig: {
      cmd: 'haskell-language-server-not-found'
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected fail-open fallback when haskell command is unavailable');
  const checks = result.diagnostics?.['haskell-language-server']?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'haskell_command_unavailable'),
    true,
    'expected command unavailable warning'
  );
});

console.log('haskell provider command fallback test passed');

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
  name: 'haskell-provider-bootstrap',
  directories: ['src'],
  files: [{ path: 'stack.yaml', content: 'resolver: lts-22.0\n' }]
});
const fixtureHaskellCmd = resolveLspFixtureCommand('haskell-language-server', { repoRoot: root });
const docText = 'greet :: Text -> Text\ngreet name = name\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'haskell-bootstrap',
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
      cmd: fixtureHaskellCmd
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), true, 'expected haskell provider to enrich symbol');
  const hit = result.byChunkUid.get(inputs.chunkUid);
  assert.equal(hit.payload?.returnType, 'Text', 'expected parsed Haskell return type');
  assert.equal(hit.payload?.paramTypes?.arg1?.[0]?.type, 'Text', 'expected parsed Haskell param type');
  const providerDiag = result.diagnostics?.['haskell-language-server'] || null;
  assert.ok(providerDiag && providerDiag.runtime, 'expected runtime diagnostics for haskell provider');

  console.log('haskell provider bootstrap test passed');
});

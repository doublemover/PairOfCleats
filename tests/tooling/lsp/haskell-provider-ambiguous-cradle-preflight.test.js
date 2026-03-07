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
  name: 'haskell-provider-ambiguous-cradle-preflight',
  directories: ['src'],
  files: [
    { path: 'stack.yaml', content: 'resolver: lts-22.0\n' },
    { path: 'sample.cabal', content: 'name: sample\nversion: 0.1.0.0\n' }
  ]
});
const fixtureHaskellCmd = resolveLspFixtureCommand('haskell-language-server', { repoRoot: root });
const docText = 'greet :: Text -> Text\ngreet name = name\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'haskell-ambiguous-cradle-preflight',
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

  assert.equal(result.byChunkUid.has(inputs.chunkUid), true, 'expected haskell provider to fail-open on ambiguous cradle');
  const diagnostics = result.diagnostics?.['haskell-language-server'] || {};
  assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected haskell preflight degraded state');
  assert.equal(
    diagnostics?.preflight?.reasonCode,
    'haskell_workspace_ambiguous_cradle',
    'expected haskell ambiguous cradle reason code'
  );
  const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'haskell_workspace_ambiguous_cradle'),
    true,
    'expected haskell ambiguous cradle warning check'
  );
});

console.log('haskell provider ambiguous cradle preflight test passed');

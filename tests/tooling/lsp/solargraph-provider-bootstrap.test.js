#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo,
  resolveLspFixtureCommand,
  runDedicatedProviderFixture
} from '../../helpers/lsp-provider-fixture.js';
import { requireLspCommandOrSkip, withLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = await createLspProviderTempRepo({
  repoRoot: root,
  name: 'solargraph-provider-bootstrap',
  directories: ['lib'],
  files: [{ path: 'Gemfile', content: "source 'https://rubygems.org'\n" }]
});
const fixtureSolargraphCmd = resolveLspFixtureCommand('solargraph', { repoRoot: root });
const docText = 'def greet(name, title = nil)\n  "#{title} #{name}"\nend\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'solargraph-bootstrap',
  virtualPath: 'lib/app.rb',
  text: docText,
  languageId: 'ruby',
  effectiveExt: '.rb',
  symbolName: 'greet'
});

await withLspTestPath({ repoRoot: root }, async () => {
  requireLspCommandOrSkip({
    providerId: 'solargraph',
    cmd: fixtureSolargraphCmd,
    repoRoot: tempRoot,
    reason: 'Skipping solargraph bootstrap test; fixture solargraph command probe failed.'
  });

  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: 'solargraph',
    providerConfigKey: 'solargraph',
    providerConfig: {
      cmd: fixtureSolargraphCmd
    },
    inputs
  });

  const providerDiag = result.diagnostics?.solargraph || null;
  assert.ok(providerDiag, 'expected diagnostics for solargraph provider');
  if (result.byChunkUid.has(inputs.chunkUid)) {
    const hit = result.byChunkUid.get(inputs.chunkUid);
    assert.equal(hit.payload?.returnType, 'String', 'expected parsed Ruby return type');
    assert.equal(hit.payload?.paramTypes?.name?.[0]?.type, 'String', 'expected parsed Ruby param type');
  } else {
    const checks = Array.isArray(providerDiag?.checks) ? providerDiag.checks : [];
    assert.equal(
      checks.length > 0 || Boolean(providerDiag?.runtime),
      true,
      'expected diagnostics metadata when solargraph did not enrich'
    );
  }
});

console.log('solargraph provider bootstrap test passed');

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
  name: 'solargraph-provider-gemfile-lock-missing-preflight',
  directories: ['lib'],
  files: [{ path: 'Gemfile', content: "source 'https://rubygems.org'\n" }]
});
const fixtureSolargraphCmd = resolveLspFixtureCommand('solargraph', { repoRoot: root });
const docText = 'def greet(name)\n  name\nend\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'solargraph-gemfile-lock-missing-preflight',
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
    reason: 'Skipping solargraph Gemfile.lock preflight test; fixture solargraph command probe failed.'
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

  const diagnostics = result.diagnostics?.solargraph || {};
  assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected solargraph preflight degraded state');
  assert.equal(
    diagnostics?.preflight?.reasonCode,
    'solargraph_workspace_gemfile_lock_missing',
    'expected solargraph Gemfile.lock-missing reason code'
  );
  const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'solargraph_workspace_gemfile_lock_missing'),
    true,
    'expected solargraph Gemfile.lock-missing warning check'
  );
});

console.log('solargraph provider Gemfile.lock missing preflight test passed');

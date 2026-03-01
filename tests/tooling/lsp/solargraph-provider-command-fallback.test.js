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
  name: 'solargraph-provider-command-fallback',
  directories: ['lib'],
  files: [{ path: 'Gemfile', content: "source 'https://rubygems.org'\n" }]
});
const docText = 'def greet(name)\n  name\nend\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'solargraph-command-fallback',
  virtualPath: 'lib/app.rb',
  text: docText,
  languageId: 'ruby',
  effectiveExt: '.rb',
  symbolName: 'greet'
});

await withLspTestPath({ repoRoot: root }, async () => {
  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: 'solargraph',
    providerConfigKey: 'solargraph',
    providerConfig: {
      cmd: 'solargraph-command-not-found'
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected fail-open fallback when solargraph command is unavailable');
  const checks = result.diagnostics?.solargraph?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'solargraph_command_unavailable'),
    true,
    'expected command unavailable warning'
  );
});

console.log('solargraph provider command fallback test passed');

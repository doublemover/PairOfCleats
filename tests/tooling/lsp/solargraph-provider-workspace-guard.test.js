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
  name: 'solargraph-provider-guard',
  directories: ['lib']
});
const docText = 'def greet(name)\n  name\nend\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'solargraph-guard',
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
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected guard to skip solargraph without Gemfile');
  const checks = result.diagnostics?.solargraph?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'solargraph_workspace_model_missing'),
    true,
    'expected workspace model missing warning'
  );
});

console.log('solargraph provider workspace guard test passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo,
  resolveLspStubServerPath,
  runDedicatedProviderFixture
} from '../../helpers/lsp-provider-fixture.js';

const root = process.cwd();
const tempRoot = await createLspProviderTempRepo({
  repoRoot: root,
  name: 'phpactor-provider-composer-invalid-preflight',
  directories: ['src'],
  files: [{ path: 'composer.json', content: '{ "name": "fixture/php", \n' }]
});
const docText = '<?php\nfunction greet(string $name): string { return $name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'phpactor-composer-invalid-preflight',
  virtualPath: 'src/app.php',
  text: docText,
  languageId: 'php',
  effectiveExt: '.php',
  symbolName: 'greet'
});

const result = await runDedicatedProviderFixture({
  tempRoot,
  authorizeFixtureExecution: true,
  providerId: 'phpactor',
  providerConfigKey: 'phpactor',
  providerConfig: { cmd: process.execPath,
    args: [resolveLspStubServerPath(), '--mode', 'php', 'language-server'] },
  inputs
});
assert.equal(result.byChunkUid.has(inputs.chunkUid), true);
assert.equal(result.diagnostics.phpactor.preflight.state, 'degraded');
assert.equal(result.diagnostics.phpactor.preflight.reasonCode, 'phpactor_workspace_composer_invalid');
assert.ok(result.diagnostics.phpactor.checks.some(check => check.name === 'phpactor_workspace_composer_invalid'));

console.log('phpactor provider workspace composer invalid preflight test passed');

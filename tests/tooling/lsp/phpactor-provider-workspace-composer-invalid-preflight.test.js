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
  name: 'phpactor-provider-composer-invalid-preflight',
  directories: ['src'],
  files: [{ path: 'composer.json', content: '{ "name": "fixture/php", \n' }]
});
const fixturePhpactorCmd = resolveLspFixtureCommand('phpactor', { repoRoot: root });
const docText = '<?php\nfunction greet(string $name): string { return $name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'phpactor-composer-invalid-preflight',
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
    providerConfig: {
      cmd: fixturePhpactorCmd
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), true, 'expected phpactor provider to fail-open on invalid composer.json');
  const diagnostics = result.diagnostics?.phpactor || {};
  assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected phpactor preflight degraded state');
  assert.equal(
    diagnostics?.preflight?.reasonCode,
    'phpactor_workspace_composer_invalid',
    'expected phpactor preflight invalid composer reason code'
  );
  const checks = diagnostics?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'phpactor_workspace_composer_invalid'),
    true,
    'expected invalid composer preflight warning check'
  );
});

console.log('phpactor provider workspace composer invalid preflight test passed');

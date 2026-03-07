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
  name: 'phpactor-provider-composer-lock-missing-preflight',
  directories: ['src'],
  files: [{ path: 'composer.json', content: '{ "name": "fixture/php" }\n' }]
});
const fixturePhpactorCmd = resolveLspFixtureCommand('phpactor', { repoRoot: root });
const docText = '<?php\nfunction greet(string $name): string { return $name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'phpactor-composer-lock-missing-preflight',
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

  assert.equal(result.byChunkUid.has(inputs.chunkUid), true, 'expected phpactor provider to continue when composer.lock is missing');
  const diagnostics = result.diagnostics?.phpactor || {};
  assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected phpactor preflight degraded state');
  assert.equal(
    diagnostics?.preflight?.reasonCode,
    'phpactor_workspace_composer_lock_missing',
    'expected phpactor composer.lock-missing reason code'
  );
  const checks = diagnostics?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'phpactor_workspace_composer_lock_missing'),
    true,
    'expected composer.lock-missing preflight warning check'
  );
});

console.log('phpactor provider composer.lock missing preflight test passed');

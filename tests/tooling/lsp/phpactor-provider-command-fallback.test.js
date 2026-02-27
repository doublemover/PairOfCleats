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
  name: 'phpactor-provider-command-fallback',
  directories: ['src'],
  files: [{ path: 'composer.json', content: '{"name":"fixture/php"}\n' }]
});
const docText = '<?php\nfunction greet(string $name): string { return $name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'phpactor-command-fallback',
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
      cmd: 'phpactor-not-found'
    },
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected fail-open fallback when phpactor command is unavailable');
  const checks = result.diagnostics?.phpactor?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'phpactor_command_unavailable'),
    true,
    'expected command unavailable warning'
  );
});

console.log('phpactor provider command fallback test passed');

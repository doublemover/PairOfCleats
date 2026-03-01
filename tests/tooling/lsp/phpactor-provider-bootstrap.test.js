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
  name: 'phpactor-provider-bootstrap',
  directories: ['src'],
  files: [{ path: 'composer.json', content: '{"name":"fixture/php"}\n' }]
});
const fixturePhpactorCmd = resolveLspFixtureCommand('phpactor', { repoRoot: root });
const docText = '<?php\nfunction greet(string $name): string { return $name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'phpactor-bootstrap',
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

  assert.equal(result.byChunkUid.has(inputs.chunkUid), true, 'expected phpactor provider to enrich PHP symbol');
  const hit = result.byChunkUid.get(inputs.chunkUid);
  assert.equal(hit.payload?.returnType, 'string', 'expected parsed PHP return type');
  assert.equal(hit.payload?.paramTypes?.name?.[0]?.type, 'string', 'expected parsed PHP param type');
  const providerDiag = result.diagnostics?.phpactor || null;
  assert.ok(providerDiag && providerDiag.runtime, 'expected runtime diagnostics for phpactor provider');
});

console.log('phpactor provider bootstrap test passed');

#!/usr/bin/env node
import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo
} from '../../helpers/lsp-provider-fixture.js';
import { runDedicatedProviderDegradedPreflightCase } from './helpers/degraded-preflight-case.js';

const root = process.cwd();
const tempRoot = await createLspProviderTempRepo({
  repoRoot: root,
  name: 'phpactor-provider-composer-lock-missing-preflight',
  directories: ['src'],
  files: [{ path: 'composer.json', content: '{ "name": "fixture/php" }\n' }]
});
const docText = '<?php\nfunction greet(string $name): string { return $name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'phpactor-composer-lock-missing-preflight',
  virtualPath: 'src/app.php',
  text: docText,
  languageId: 'php',
  effectiveExt: '.php',
  symbolName: 'greet'
});

await runDedicatedProviderDegradedPreflightCase({
  root,
  repo: tempRoot,
  providerId: 'phpactor',
  providerConfigKey: 'phpactor',
  fixtureCommand: 'phpactor',
  inputs,
  expectedEnrichment: true,
  expectedReasonCode: 'phpactor_workspace_composer_lock_missing',
  expectedCheckName: 'phpactor_workspace_composer_lock_missing',
  messages: {
    enrichment: 'expected phpactor provider to continue when composer.lock is missing',
    reasonCode: 'expected phpactor composer.lock-missing reason code',
    check: 'expected composer.lock-missing preflight warning check'
  }
});

console.log('phpactor provider composer.lock missing preflight test passed');

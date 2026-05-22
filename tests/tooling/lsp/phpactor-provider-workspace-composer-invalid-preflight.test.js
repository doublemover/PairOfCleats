#!/usr/bin/env node
import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo
} from '../../helpers/lsp-provider-fixture.js';
import { runDedicatedProviderDegradedPreflightCase } from './helpers/degraded-preflight-case.js';

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

await runDedicatedProviderDegradedPreflightCase({
  root,
  repo: tempRoot,
  providerId: 'phpactor',
  providerConfigKey: 'phpactor',
  fixtureCommand: 'phpactor',
  inputs,
  expectedEnrichment: true,
  expectedReasonCode: 'phpactor_workspace_composer_invalid',
  expectedCheckName: 'phpactor_workspace_composer_invalid',
  messages: {
    enrichment: 'expected phpactor provider to fail-open on invalid composer.json',
    reasonCode: 'expected phpactor preflight invalid composer reason code',
    check: 'expected invalid composer preflight warning check'
  }
});

console.log('phpactor provider workspace composer invalid preflight test passed');

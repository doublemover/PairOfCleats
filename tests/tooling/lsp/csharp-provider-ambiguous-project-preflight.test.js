#!/usr/bin/env node
import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo
} from '../../helpers/lsp-provider-fixture.js';
import { runDedicatedProviderDegradedPreflightCase } from './helpers/degraded-preflight-case.js';

const root = process.cwd();
const tempRoot = await createLspProviderTempRepo({
  repoRoot: root,
  name: 'csharp-provider-ambiguous-project-preflight',
  directories: ['src'],
  files: [
    { path: 'AppA.csproj', content: '<Project/>' },
    { path: 'AppB.csproj', content: '<Project/>' }
  ]
});
const docText = 'class App { string Greet(string name) => name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'csharp-ambiguous-project-preflight',
  virtualPath: 'src/App.cs',
  text: docText,
  languageId: 'csharp',
  effectiveExt: '.cs',
  symbolName: 'Greet'
});

await runDedicatedProviderDegradedPreflightCase({
  root,
  repo: tempRoot,
  providerId: 'csharp-ls',
  providerConfigKey: 'csharp',
  fixtureCommand: 'csharp-ls',
  inputs,
  expectedEnrichment: true,
  expectedReasonCode: 'csharp_workspace_ambiguous_project',
  expectedCheckName: 'csharp_workspace_ambiguous_project',
  messages: {
    enrichment: 'expected csharp provider to continue with ambiguous project roots',
    reasonCode: 'expected csharp ambiguous project reason code',
    check: 'expected csharp ambiguous project warning check'
  }
});

console.log('csharp provider ambiguous project preflight test passed');

#!/usr/bin/env node
import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo
} from '../../helpers/lsp-provider-fixture.js';
import { runDedicatedProviderDegradedPreflightCase } from './helpers/degraded-preflight-case.js';

const root = process.cwd();
const tempRoot = await createLspProviderTempRepo({
  repoRoot: root,
  name: 'csharp-provider-ambiguous-solution-preflight',
  directories: ['src'],
  files: [
    { path: 'App.csproj', content: '<Project/>' },
    { path: 'AppA.sln', content: 'Microsoft Visual Studio Solution File, Format Version 12.00\n' },
    { path: 'AppB.sln', content: 'Microsoft Visual Studio Solution File, Format Version 12.00\n' }
  ]
});
const docText = 'class App { string Greet(string name) => name; }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'csharp-ambiguous-solution-preflight',
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
  expectedReasonCode: 'csharp_workspace_ambiguous_solution',
  expectedCheckName: 'csharp_workspace_ambiguous_solution',
  messages: {
    enrichment: 'expected csharp provider to fail-open when workspace solution is ambiguous',
    reasonCode: 'expected csharp ambiguous solution reason code',
    check: 'expected csharp ambiguous solution warning check'
  }
});

console.log('csharp provider ambiguous solution preflight test passed');

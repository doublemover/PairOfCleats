#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSingleSymbolDegradedPreflightCase } from './helpers/degraded-preflight-case.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const docText = 'def alpha() -> int:\n    return 1\n';
await runSingleSymbolDegradedPreflightCase({
  root,
  name: 'pyright-preflight-workspace-config-invalid',
  directories: ['src'],
  files: [
    { path: 'src/one.py', content: docText },
    { path: 'pyrightconfig.json', content: '{ "venvPath": ' }
  ],
  providerId: 'pyright',
  providerConfigKey: 'pyright',
  fixtureCommand: 'pyright-langserver',
  input: {
    scenarioName: 'pyright-workspace-config-invalid',
    virtualPath: 'src/one.py',
    text: docText,
    languageId: 'python',
    effectiveExt: '.py',
    symbolName: 'alpha'
  },
  expectedReasonCode: 'pyright_workspace_config_invalid',
  expectedCheckName: 'pyright_workspace_config_invalid',
  messages: {
    enrichment: 'expected pyright output even with degraded workspace-config preflight',
    reasonCode: 'expected pyright workspace-config invalid reason code',
    check: 'expected pyright workspace-config invalid warning check'
  }
});

console.log('pyright preflight workspace config invalid test passed');

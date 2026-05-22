#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSingleSymbolDegradedPreflightCase } from './helpers/degraded-preflight-case.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const docText = 'def alpha() -> int:\n    return 1\n';
await runSingleSymbolDegradedPreflightCase({
  root,
  name: `pyright-preflight-workspace-mono-root-${process.pid}-${Date.now()}`,
  directories: ['pkg-a', 'pkg-b', 'src'],
  files: [
    { path: 'pkg-a/pyproject.toml', content: '[project]\nname = "a"\n' },
    { path: 'pkg-b/setup.py', content: 'from setuptools import setup\nsetup()\n' },
    { path: 'src/one.py', content: docText }
  ],
  providerId: 'pyright',
  providerConfigKey: 'pyright',
  fixtureCommand: 'pyright-langserver',
  input: {
    scenarioName: 'pyright-workspace-mono-root',
    virtualPath: 'src/one.py',
    text: docText,
    languageId: 'python',
    effectiveExt: '.py',
    symbolName: 'alpha'
  },
  expectedReasonCode: 'pyright_workspace_mono_root',
  expectedCheckName: 'pyright_workspace_mono_root',
  messages: {
    enrichment: 'expected pyright output even with mono-root warning',
    reasonCode: 'expected pyright mono-root reason code',
    check: 'expected pyright mono-root warning check'
  }
});

console.log('pyright preflight workspace mono-root test passed');

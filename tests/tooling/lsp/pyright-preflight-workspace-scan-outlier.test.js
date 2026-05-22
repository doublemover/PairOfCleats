#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSingleSymbolDegradedPreflightCase } from './helpers/degraded-preflight-case.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const docText = 'def alpha() -> int:\n    return 1\n';
await runSingleSymbolDegradedPreflightCase({
  root,
  name: `pyright-preflight-workspace-scan-outlier-${process.pid}-${Date.now()}`,
  directories: ['src', 'pkg-a', 'pkg-b'],
  files: [
    { path: 'src/one.py', content: docText },
    { path: 'pkg-a/a.py', content: 'A = 1\n' },
    { path: 'pkg-b/b.py', content: 'B = 2\n' }
  ],
  providerId: 'pyright',
  providerConfigKey: 'pyright',
  fixtureCommand: 'pyright-langserver',
  providerConfig: {
    workspaceScanOutlierEntryThreshold: 1,
    workspaceScanOutlierDurationMs: 1_000_000
  },
  input: {
    scenarioName: 'pyright-workspace-scan-outlier',
    virtualPath: 'src/one.py',
    text: docText,
    languageId: 'python',
    effectiveExt: '.py',
    symbolName: 'alpha'
  },
  expectedReasonCode: 'pyright_workspace_scan_outlier',
  expectedCheckName: 'pyright_workspace_scan_outlier',
  messages: {
    enrichment: 'expected pyright output even with scan-outlier warning',
    reasonCode: 'expected pyright scan-outlier reason code',
    check: 'expected pyright scan-outlier warning check'
  }
});

console.log('pyright preflight workspace scan outlier test passed');

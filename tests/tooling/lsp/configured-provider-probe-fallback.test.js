#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveLspFixtureCommand } from '../../helpers/lsp-provider-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { rmDirRecursive } from '../../helpers/temp.js';

const root = process.cwd();
const { dir: tempRoot } = await prepareIsolatedTestCacheDir('configured-provider-probe-fallback', { root });
const fixtureCommand = resolveLspFixtureCommand('probe-fail-lsp', { repoRoot: root });
const docText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';

try {
  await fs.mkdir(tempRoot, { recursive: true });

  const result = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['lsp-gopls'],
      lsp: {
        enabled: true,
        servers: [{
          id: 'gopls',
          preset: 'gopls',
          cmd: fixtureCommand,
          args: ['--mode', 'go'],
          languages: ['go'],
          uriScheme: 'poc-vfs',
          requireWorkspaceModel: false
        }]
      }
    },
    cache: {
      enabled: false
    }
  }, {
    documents: [{
      virtualPath: '.poc-vfs/src/sample.go#seg:configured-provider-probe-fallback.txt',
      text: docText,
      languageId: 'go',
      effectiveExt: '.go',
      docHash: 'hash-configured-provider-probe-fallback'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid: 'ck64:v1:test:src/sample.go:configured-provider-probe-fallback',
        chunkId: 'chunk_configured_provider_probe_fallback',
        file: 'src/sample.go',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: '.poc-vfs/src/sample.go#seg:configured-provider-probe-fallback.txt',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'Add', kind: 'function' },
      languageId: 'go'
    }],
    kinds: ['types']
  });

  const checks = result.diagnostics?.['lsp-gopls']?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'tooling_initialize_failed'),
    false,
    'expected configured provider initialization to proceed despite probe failure'
  );
  assert.equal(
    checks.some((check) => check?.name === 'lsp_command_unavailable'),
    true,
    'expected probe failure warning check'
  );
  assert.equal(
    Number(result.metrics?.requests?.requests || 0) > 0,
    true,
    'expected LSP request activity after probe failure'
  );
  assert.equal(
    Number(result.metrics?.providersContributed || 0) > 0,
    true,
    'expected provider to contribute runtime work after probe failure'
  );

  console.log('configured provider probe fallback test passed');
} finally {
  await rmDirRecursive(tempRoot, { retries: 8, delayMs: 150 });
}

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { __testLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-lua-hover-timeout-${process.pid}-${Date.now()}`);
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'function greet(name)\n  return name\nend\n';
const chunkUid = 'ck64:v1:test:src/sample.lua:lua-hover-timeout';

const runProvider = () => runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-lua-hover-timeout'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'lua-hover-timeout',
        preset: 'lua-language-server',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'lua-hover-timeout'],
        languages: ['lua'],
        uriScheme: 'poc-vfs',
        timeoutMs: 500,
        hoverTimeoutMs: 150,
        retries: 0,
        breakerThreshold: 1
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/sample.lua#seg:lua-hover-timeout.txt',
    text: docText,
    languageId: 'lua',
    effectiveExt: '.lua',
    docHash: 'hash-lua-hover-timeout'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_lua_hover_timeout',
      file: 'src/sample.lua',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/sample.lua#seg:lua-hover-timeout.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'greet', kind: 'function' },
    languageId: 'lua'
  }],
  kinds: ['types']
});

try {
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });
  __testLspSessionPool.setQuarantineDurations({ shortMs: 120, extendedMs: 600 });

  let escalated = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await runProvider();
    const diagnostics = current.diagnostics?.['lsp-lua-hover-timeout'] || {};
    const timedOut = Array.isArray(diagnostics.checks)
      && diagnostics.checks.some((check) => check?.name === 'tooling_hover_timeout');
    const quarantinedNow = Array.isArray(diagnostics.checks)
      && diagnostics.checks.some((check) => check?.name === 'tooling_provider_quarantined');

    assert.equal(
      timedOut || quarantinedNow,
      true,
      `expected hover timeout degradation or quarantine on attempt ${attempt + 1}`
    );

    if (diagnostics.runtime?.lifecycle?.quarantine?.level === 'extended') {
      escalated = current;
      break;
    }
  }

  assert.ok(escalated, 'expected repeated Lua hover timeouts to escalate into extended quarantine');

  const firstHit = escalated.byChunkUid.get(chunkUid);
  if (firstHit) {
    assert.equal(firstHit.payload?.paramTypes?.name?.[0]?.type, 'string', 'expected documentSymbol payload to survive hover timeout before quarantine');
  }

  const quarantined = await runProvider();
  const diagnostics = quarantined.diagnostics?.['lsp-lua-hover-timeout'] || {};
  assert.equal(
    Array.isArray(diagnostics.checks)
    && diagnostics.checks.some((check) => check?.name === 'tooling_provider_quarantined'),
    true,
    'expected active Lua quarantine to fail open with explicit warning'
  );
  assert.equal(
    diagnostics.runtime?.lifecycle?.quarantine?.level,
    'extended',
    'expected Lua quarantine summary to retain extended level'
  );
  assert.equal(
    diagnostics.runtime?.requests?.byMethod?.['textDocument/hover']?.requests ?? 0,
    0,
    'expected active Lua quarantine to avoid replaying hover requests'
  );

  console.log('configured LSP lua hover timeout quarantine test passed');
} finally {
  await __testLspSessionPool.reset();
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { __testLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
import { sleep } from '../../../src/shared/sleep.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-provider-timeout-quarantine-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:timeout-quarantine.cpp';

const parseSignature = (detailText) => {
  const detail = String(detailText || '').trim();
  if (detail !== 'add') return null;
  return {
    signature: detail,
    returnType: 'unknown',
    paramTypes: {},
    paramNames: ['a', 'b']
  };
};

const runCollect = async () => collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  providerId: 'lsp-provider-timeout-quarantine',
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'cpp',
    effectiveExt: '.cpp'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:src/sample.cpp:timeout-quarantine',
      chunkId: 'chunk_timeout_quarantine',
      file: 'src/sample.cpp',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath,
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'add', kind: 'function' }
  }],
  cmd: process.execPath,
  args: [serverPath, '--mode', 'stall-signature-help'],
  parseSignature,
  retries: 0,
  timeoutMs: 600,
  signatureHelpTimeoutMs: 180,
  sessionIdleTimeoutMs: 60_000,
  sessionMaxLifetimeMs: 120_000
});

try {
  __testLspSessionPool.setQuarantineDurations({ shortMs: 120, extendedMs: 600 });

  let escalated = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await runCollect();
    const timedOut = current.checks.some((check) => check?.name === 'tooling_signature_help_timeout');
    const quarantinedNow = current.checks.some((check) => check?.name === 'tooling_provider_quarantined');
    assert.equal(
      timedOut || quarantinedNow,
      true,
      `expected timeout degradation or quarantine on attempt ${attempt + 1}`
    );
    if (current?.runtime?.lifecycle?.quarantine?.level === 'extended') {
      escalated = current;
      break;
    }
    await sleep(160);
  }

  assert.ok(escalated, 'expected timeout storm to escalate into extended quarantine');

  const quarantined = await runCollect();
  assert.equal(
    quarantined.checks.some((check) => check?.name === 'tooling_provider_quarantined'),
    true,
    'expected active extended quarantine to fail open with explicit warning'
  );
  assert.equal(
    quarantined.runtime?.lifecycle?.quarantine?.level,
    'extended',
    'expected provider quarantine summary to retain extended level'
  );

  console.log('LSP provider timeout quarantine test passed');
} finally {
  await __testLspSessionPool.reset();
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}

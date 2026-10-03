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
const tempRoot = resolveTestCachePath(root, `lsp-provider-quarantine-recovery-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const stubServerPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const launcherPath = path.join(tempRoot, 'stub-launcher.js');
const modePath = path.join(tempRoot, 'mode.txt');
await fs.writeFile(
  launcherPath,
  `import fs from 'node:fs';\n`
  + `import { spawn } from 'node:child_process';\n`
  + `const modePath = process.argv[2];\n`
  + `const stubPath = process.argv[3];\n`
  + `const mode = fs.readFileSync(modePath, 'utf8').trim() || 'cpp';\n`
  + `const child = spawn(process.execPath, [stubPath, '--mode', mode], { stdio: 'inherit' });\n`
  + `child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));\n`,
  'utf8'
);

const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:quarantine-recovery.cpp';
const runCollect = async () => collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  providerId: 'lsp-provider-quarantine-recovery',
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'cpp',
    effectiveExt: '.cpp'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:src/sample.cpp:quarantine-recovery',
      chunkId: 'chunk_quarantine_recovery',
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
  args: [launcherPath, modePath, stubServerPath],
  parseSignature: (detail) => ({
    signature: detail,
    returnType: 'int',
    paramTypes: { a: 'int', b: 'int' }
  }),
  retries: 0,
  timeoutMs: 1200,
  sessionIdleTimeoutMs: 60_000,
  sessionMaxLifetimeMs: 120_000
});

try {
  __testLspSessionPool.setQuarantineDurations({ shortMs: 250, extendedMs: 800 });

  await fs.writeFile(modePath, 'malformed-initialize', 'utf8');
  const failed = await runCollect();
  assert.equal(Object.keys(failed.byChunkUid).length, 0, 'expected malformed initialize to fail open');
  assert.equal(
    failed.checks.some((check) => check?.name === 'tooling_initialize_failed'),
    true,
    'expected initialize failure warning'
  );
  assert.equal(
    failed.runtime?.lifecycle?.quarantine?.level,
    'short',
    'expected handshake failure to arm short quarantine'
  );

  const quarantined = await runCollect();
  assert.equal(Object.keys(quarantined.byChunkUid).length, 0, 'expected active quarantine to keep fail-open result empty');
  assert.equal(
    quarantined.checks.some((check) => check?.name === 'tooling_provider_quarantined'),
    true,
    'expected explicit quarantine warning during cooldown'
  );

  await fs.writeFile(modePath, 'cpp', 'utf8');
  await sleep(300);
  const recovered = await runCollect();
  assert.equal(
    Object.keys(recovered.byChunkUid).length >= 1,
    true,
    'expected provider to recover after quarantine cooldown'
  );
  assert.equal(
    recovered.checks.some((check) => check?.name === 'tooling_provider_quarantined'),
    false,
    'expected successful recovery run to avoid quarantine warning'
  );

  console.log('LSP provider quarantine recovery test passed');
} finally {
  await __testLspSessionPool.reset();
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}

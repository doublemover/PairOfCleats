#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { __testPyrightRuntimeHealth } from '../../../src/index/tooling/pyright-runtime-health.js';
import { __testLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `pyright-recovery-fingerprint-${process.pid}-${Date.now()}`);
const stubServerPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const launcherPath = path.join(tempRoot, 'stub-launcher.js');
const modePath = path.join(tempRoot, 'mode.txt');

const baseConfig = {
  enabledTools: ['pyright'],
  pyright: {
    cmd: process.execPath,
    args: [launcherPath, modePath, stubServerPath],
    timeoutMs: 500,
    documentSymbolTimeoutMs: 150,
    retries: 0,
    breakerThreshold: 1
  }
};

const failingInputs = {
  documents: [
    {
      virtualPath: 'src/core.py',
      text: 'def alpha() -> int:\n    return 1\n',
      languageId: 'python',
      effectiveExt: '.py',
      docHash: 'hash-pyright-recovery-core'
    },
    {
      virtualPath: 'src/helpers.py',
      text: 'def beta() -> int:\n    return 2\n',
      languageId: 'python',
      effectiveExt: '.py',
      docHash: 'hash-pyright-recovery-helper'
    }
  ],
  targets: [
    {
      chunkRef: {
        docId: 0,
        chunkUid: 'ck:test:pyright-recovery:core',
        chunkId: 'chunk_pyright_recovery_core',
        file: 'src/core.py',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: 33 }
      },
      virtualPath: 'src/core.py',
      virtualRange: { start: 0, end: 33 },
      symbolHint: { name: 'alpha', kind: 'function' },
      languageId: 'python'
    },
    {
      chunkRef: {
        docId: 1,
        chunkUid: 'ck:test:pyright-recovery:helper',
        chunkId: 'chunk_pyright_recovery_helper',
        file: 'src/helpers.py',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: 32 }
      },
      virtualPath: 'src/helpers.py',
      virtualRange: { start: 0, end: 32 },
      symbolHint: { name: 'beta', kind: 'function' },
      languageId: 'python'
    }
  ],
  kinds: ['types']
};

const recoveredInputs = {
  documents: [
    {
      virtualPath: 'src/core.py',
      text: 'def alpha() -> int:\n    return 1\n',
      languageId: 'python',
      effectiveExt: '.py',
      docHash: 'hash-pyright-recovery-core-v2'
    }
  ],
  targets: [
    {
      chunkRef: {
        docId: 0,
        chunkUid: 'ck:test:pyright-recovery:core-v2',
        chunkId: 'chunk_pyright_recovery_core_v2',
        file: 'src/core.py',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: 33 }
      },
      virtualPath: 'src/core.py',
      virtualRange: { start: 0, end: 33 },
      symbolHint: { name: 'alpha', kind: 'function' },
      languageId: 'python'
    }
  ],
  kinds: ['types']
};

registerDefaultToolingProviders();

try {
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'pyproject.toml'), '[project]\nname = "pyright-recovery"\n', 'utf8');
  await fs.writeFile(
    launcherPath,
    `import fs from 'node:fs';\n`
    + `import { spawn } from 'node:child_process';\n`
    + `const modePath = process.argv[2];\n`
    + `const stubPath = process.argv[3];\n`
    + `const mode = fs.readFileSync(modePath, 'utf8').trim() || 'pyright';\n`
    + `const child = spawn(process.execPath, [stubPath, '--mode', mode], { stdio: 'inherit' });\n`
    + `child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));\n`,
    'utf8'
  );
  await fs.writeFile(modePath, 'stall-document-symbol', 'utf8');
  __testPyrightRuntimeHealth.reset();

  const failed = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: baseConfig,
    cache: {
      enabled: false
    }
  }, failingInputs);

  assert.equal(failed.diagnostics?.pyright?.health?.nextState, 'degraded_hard', 'expected failing run to seed degraded_hard state');

  await fs.writeFile(modePath, 'pyright', 'utf8');
  const recovered = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: baseConfig,
    cache: {
      enabled: false
    }
  }, recoveredInputs);

  assert.equal(recovered.byChunkUid.has('ck:test:pyright-recovery:core-v2'), true, 'expected fingerprint-changed rerun to recover');
  assert.equal(recovered.diagnostics?.pyright?.health?.state, 'warming', 'expected fingerprint change to re-enter warming state');
  assert.equal(recovered.diagnostics?.pyright?.health?.nextState, 'healthy', 'expected successful warming run to promote back to healthy');
  assert.equal(
    Array.isArray(recovered.diagnostics?.pyright?.checks)
    && recovered.diagnostics.pyright.checks.some((check) => check?.name === 'pyright_quarantined_for_run'),
    false,
    'expected fingerprint-changed recovery run to bypass quarantine short-circuit'
  );

  console.log('pyright provider recovery fingerprint test passed');
} finally {
  __testPyrightRuntimeHealth.reset();
  await __testLspSessionPool.reset();
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}

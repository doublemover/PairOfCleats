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
const tempRoot = resolveTestCachePath(root, `pyright-hover-timeout-state-${process.pid}-${Date.now()}`);
const stubServerPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const launcherPath = path.join(tempRoot, 'stub-launcher.js');
const modePath = path.join(tempRoot, 'mode.txt');

const inputs = {
  documents: [
    {
      virtualPath: 'src/core.py',
      text: 'def greet(name):\n    return name\n',
      languageId: 'python',
      effectiveExt: '.py',
      docHash: 'hash-pyright-hover-timeout-core'
    }
  ],
  targets: [
    {
      chunkRef: {
        docId: 0,
        chunkUid: 'ck:test:pyright-hover-timeout:core',
        chunkId: 'chunk_pyright_hover_timeout_core',
        file: 'src/core.py',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: 32 }
      },
      virtualPath: 'src/core.py',
      virtualRange: { start: 0, end: 32 },
      symbolHint: { name: 'greet', kind: 'function' },
      languageId: 'python'
    }
  ],
  kinds: ['types']
};

const toolingConfig = {
  enabledTools: ['pyright'],
  pyright: {
    cmd: process.execPath,
    args: [launcherPath, modePath, stubServerPath],
    timeoutMs: 500,
    hoverTimeoutMs: 150,
    retries: 0,
    breakerThreshold: 1
  }
};

registerDefaultToolingProviders();

try {
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'pyproject.toml'), '[project]\nname = "pyright-hover-timeout"\n', 'utf8');
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
  await fs.writeFile(modePath, 'pyright-hover-timeout', 'utf8');
  __testPyrightRuntimeHealth.reset();

  const first = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig,
    cache: {
      enabled: false
    }
  }, inputs);

  assert.equal(first.byChunkUid.size, 1, 'expected documentSymbol enrichment to survive hover timeout');
  assert.equal(
    first.diagnostics?.pyright?.runtime?.requests?.byMethod?.['textDocument/hover']?.timedOut,
    1,
    'expected hover timeout to be recorded'
  );
  assert.equal(first.diagnostics?.pyright?.health?.state, 'degraded_soft', 'expected hover timeout run to enter degraded_soft');
  assert.equal(first.diagnostics?.pyright?.health?.nextState, 'degraded_hard', 'expected hover timeout run to persist degraded_hard next state');
  assert.equal(first.diagnostics?.pyright?.health?.reasonCode, 'hover_timeout', 'expected hover timeout reason code');
  assert.equal(first.diagnostics?.pyright?.fallback?.state, 'degraded_soft', 'expected fallback contract to reflect degraded_soft');
  assert.equal(
    Array.isArray(first.diagnostics?.pyright?.checks)
    && first.diagnostics.pyright.checks.some((check) => check?.name === 'pyright_timeout_storm_truncated'),
    true,
    'expected explicit timeout-storm truncation warning for hover timeouts'
  );

  const second = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig,
    cache: {
      enabled: false
    }
  }, inputs);

  assert.equal(second.byChunkUid.size, 0, 'expected quarantined rerun to fail open without enrichment');
  assert.equal(second.diagnostics?.pyright?.health?.state, 'quarantined_for_run', 'expected same fingerprint rerun to be quarantined');
  assert.equal(second.diagnostics?.pyright?.fallback?.state, 'quarantined_for_run', 'expected fallback contract to reflect active quarantine');
  assert.equal(
    Array.isArray(second.diagnostics?.pyright?.checks)
    && second.diagnostics.pyright.checks.some((check) => check?.name === 'pyright_quarantined_for_run'),
    true,
    'expected explicit quarantine warning on immediate rerun'
  );
  assert.equal(
    second.diagnostics?.pyright?.runtime?.requests?.byMethod?.['textDocument/hover']?.requests ?? 0,
    0,
    'expected quarantined rerun to avoid replaying hover requests'
  );

  console.log('pyright provider hover timeout state test passed');
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

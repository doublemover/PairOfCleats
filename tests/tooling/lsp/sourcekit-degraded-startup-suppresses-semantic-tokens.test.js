#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { resolveSourcekitPreflightLockPath } from '../../../src/index/tooling/sourcekit-provider.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { createSourcekitPreflightFixture } from '../../helpers/sourcekit-preflight-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = await createSourcekitPreflightFixture({
  root,
  name: 'sourcekit-degraded-startup-suppresses-semantic-tokens',
  includeDependencies: true,
  dependencyVersion: '1.0.0',
  resolveExitCode: 0
});
const logs = [];
const { ctx } = fixture.contextFor(logs);
const preflightLockPath = resolveSourcekitPreflightLockPath(ctx.repoRoot);
const stubServerPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const launcherPath = path.join(fixture.tempRoot, 'stub-launcher.js');
const modePath = path.join(fixture.tempRoot, 'mode.txt');

await fs.writeFile(
  launcherPath,
  `import fs from 'node:fs';\n`
  + `import { spawn } from 'node:child_process';\n`
  + `const modePath = process.argv[2];\n`
  + `const stubPath = process.argv[3];\n`
  + `const mode = fs.readFileSync(modePath, 'utf8').trim() || 'sourcekit';\n`
  + `const child = spawn(process.execPath, [stubPath, '--mode', mode], { stdio: 'inherit' });\n`
  + `child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));\n`,
  'utf8'
);
await fs.writeFile(modePath, 'stall-semantic-tokens', 'utf8');

const document = {
  virtualPath: 'src/one.swift',
  effectiveExt: '.swift',
  languageId: 'swift',
  text: 'func add(a: Int, b: Int) -> Int { return a + b }\n',
  docHash: 'doc-sourcekit-degraded-startup',
  containerPath: 'src/one.swift'
};
const target = {
  virtualPath: 'src/one.swift',
  languageId: 'swift',
  chunkRef: {
    chunkUid: 'ck:test:sourcekit:degraded-startup',
    chunkId: 'chunk_sourcekit_degraded_startup',
    file: 'src/one.swift',
    start: 0,
    end: document.text.length
  },
  virtualRange: {
    start: 0,
    end: document.text.length
  },
  symbolHint: {
    name: 'add',
    kind: 'function'
  }
};

let heldLock = null;
try {
  heldLock = await acquireFileLock({
    lockPath: preflightLockPath,
    waitMs: 0,
    pollMs: 25,
    staleMs: 5 * 60 * 1000,
    forceStaleCleanup: true,
    metadata: { scope: 'sourcekit-degraded-startup-test' }
  });
  assert.ok(heldLock, 'expected test to acquire sourcekit preflight lock');

  await withTemporaryEnv({ POC_SWIFT_PREFLIGHT_COUNTER: fixture.counterPath }, async () => {
    registerDefaultToolingProviders();
    const provider = getToolingProvider('sourcekit');
    assert.ok(provider, 'expected sourcekit provider');

    const output = await provider.run({
      ...ctx,
      toolingConfig: {
        sourcekit: {
          cmd: process.execPath,
          args: [launcherPath, modePath, stubServerPath],
          preflightFailOpen: true,
          preflightLockWaitMs: 0,
          preflightLockPollMs: 25,
          hoverEnabled: false,
          hoverTimeoutMs: 150,
          timeoutMs: 500,
          retries: 0,
          breakerThreshold: 1,
          hostConcurrencyGate: false
        }
      }
    }, {
      documents: [document],
      targets: [target]
    });

    assert.equal(Boolean(output?.byChunkUid?.[target.chunkRef.chunkUid]), true, 'expected sourcekit to preserve partial success under degraded startup');
    assert.equal(output?.diagnostics?.preflight?.reasonCode, 'sourcekit_preflight_lock_unavailable', 'expected degraded startup reason code to be preserved');
    assert.equal(output?.diagnostics?.runtime?.hoverMetrics?.semanticTokensTimedOut ?? 0, 0, 'expected semantic token timeout to be suppressed under degraded startup');
    assert.equal(
      Array.isArray(output?.diagnostics?.checks)
      && output.diagnostics.checks.some((check) => check?.name === 'sourcekit_semantic_tokens_suppressed_weak_startup'),
      true,
      'expected degraded-startup semantic token suppression check'
    );
  });
} finally {
  if (heldLock?.release) {
    await heldLock.release();
  }
  await fixture.restorePath();
  const cleanup = await removePathWithRetry(fixture.tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}

console.log('sourcekit degraded startup suppresses semantic tokens test passed');

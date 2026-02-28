#!/usr/bin/env node
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import { countNonEmptyLines } from '../../helpers/lsp-signature-fixtures.js';
import { createSourcekitPreflightFixture } from '../../helpers/sourcekit-preflight-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = await createSourcekitPreflightFixture({
  root,
  name: 'sourcekit-package-preflight-lock-unavailable',
  includeDependencies: true,
  dependencyVersion: '1.0.0',
  resolveExitCode: 0
});
const preflightLockPath = path.join(os.tmpdir(), 'pairofcleats', 'locks', 'sourcekit-package-preflight.lock');
const logs = [];
const { ctx, document, target } = fixture.contextFor(logs);
ctx.toolingConfig = {
  sourcekit: {
    preflightLockWaitMs: 0,
    preflightLockPollMs: 25
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
    metadata: { scope: 'sourcekit-preflight-lock-unavailable-test' }
  });
  assert.ok(heldLock, 'expected test to acquire sourcekit preflight lock');

  await withTemporaryEnv({ POC_SWIFT_PREFLIGHT_COUNTER: fixture.counterPath }, async () => {
    registerDefaultToolingProviders();
    const provider = getToolingProvider('sourcekit');
    assert.ok(provider, 'expected sourcekit provider');

    const output = await provider.run(ctx, { documents: [document], targets: [target] });
    assert.deepEqual(output.byChunkUid || {}, {}, 'expected sourcekit to skip enrichment after lock timeout');

    const checks = Array.isArray(output?.diagnostics?.checks) ? output.diagnostics.checks : [];
    assert.ok(
      checks.some((check) => check?.name === 'sourcekit_package_preflight_lock_unavailable'),
      'expected sourcekit preflight lock timeout check in diagnostics'
    );
    assert.ok(
      logs.some((line) => line.includes('sourcekit package preflight skipped because lock acquisition timed out')),
      'expected lock-timeout skip log'
    );
    const count = await countNonEmptyLines(fixture.counterPath);
    assert.equal(count, 0, 'expected no preflight resolve attempt when lock is unavailable');
  });
} finally {
  if (heldLock?.release) {
    await heldLock.release();
  }
  await fixture.restorePath();
}

console.log('sourcekit package preflight lock-unavailable test passed');

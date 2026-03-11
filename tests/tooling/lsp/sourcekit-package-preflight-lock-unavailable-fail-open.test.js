#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import {
  ensureSourcekitPackageResolutionPreflight,
  resolveSourcekitPreflightLockPath
} from '../../../src/index/tooling/preflight/sourcekit-package-resolution.js';
import { countNonEmptyLines } from '../../helpers/lsp-signature-fixtures.js';
import { createSourcekitPreflightFixture } from '../../helpers/sourcekit-preflight-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = await createSourcekitPreflightFixture({
  root,
  name: 'sourcekit-package-preflight-lock-unavailable-fail-open',
  includeDependencies: true,
  dependencyVersion: '1.0.0',
  resolveExitCode: 0
});
const logs = [];
const { ctx } = fixture.contextFor(logs);
const preflightLockPath = resolveSourcekitPreflightLockPath(ctx.repoRoot);

let heldLock = null;
try {
  heldLock = await acquireFileLock({
    lockPath: preflightLockPath,
    waitMs: 0,
    pollMs: 25,
    staleMs: 5 * 60 * 1000,
    forceStaleCleanup: true,
    metadata: { scope: 'sourcekit-preflight-lock-unavailable-fail-open-test' }
  });
  assert.ok(heldLock, 'expected test to acquire sourcekit preflight lock');

  await withTemporaryEnv({ POC_SWIFT_PREFLIGHT_COUNTER: fixture.counterPath }, async () => {
    const result = await ensureSourcekitPackageResolutionPreflight({
      repoRoot: ctx.repoRoot,
      log: (line) => logs.push(String(line || '')),
      sourcekitConfig: {
        preflightFailOpen: true,
        preflightLockWaitMs: 0,
        preflightLockPollMs: 25
      }
    });

    assert.equal(result.blockSourcekit, false, 'expected fail-open mode to preserve sourcekit on lock timeout');
    assert.equal(result.check?.name, 'sourcekit_package_preflight_lock_unavailable');
    assert.ok(
      logs.some((line) => line.includes('sourcekit package preflight skipped because lock acquisition timed out')),
      'expected lock-timeout log'
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

console.log('sourcekit package preflight lock-unavailable fail-open test passed');

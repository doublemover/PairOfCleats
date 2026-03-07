#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { resolveSourcekitHostLockPath } from '../../../src/index/tooling/sourcekit-provider.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = resolveTestCachePath(root, 'sourcekit-provider-host-lock-unavailable');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

const fixtureCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'sourcekit-lsp.cmd' : 'sourcekit-lsp'
);
await fs.access(fixtureCmd);

const hostLockPath = resolveSourcekitHostLockPath(tempRoot);

const ctx = {
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    sourcekit: {
      cmd: fixtureCmd,
      args: [],
      hostConcurrencyGate: true,
      hostConcurrencyWaitMs: 0
    }
  },
  logger: () => {},
  strict: true
};

const document = {
  virtualPath: 'src/one.swift',
  effectiveExt: '.swift',
  languageId: 'swift',
  text: 'func alpha() -> Int { return 1 }\n',
  docHash: 'doc-sourcekit-lock-unavailable',
  containerPath: 'src/one.swift'
};

const chunkUid = 'ck:test:sourcekit:host-lock-unavailable:1';
const target = {
  virtualPath: 'src/one.swift',
  languageId: 'swift',
  chunkRef: {
    chunkUid,
    chunkId: 'chunk_sourcekit_host_lock_unavailable',
    file: 'src/one.swift',
    start: 0,
    end: document.text.length
  },
  virtualRange: {
    start: 0,
    end: document.text.length
  },
  symbolHint: {
    name: 'alpha',
    kind: 'function'
  }
};

registerDefaultToolingProviders();
const provider = getToolingProvider('sourcekit');
assert.ok(provider, 'expected sourcekit provider');

const heldLock = await acquireFileLock({
  lockPath: hostLockPath,
  waitMs: 0,
  pollMs: 25,
  staleMs: 5 * 60 * 1000,
  forceStaleCleanup: true,
  metadata: { scope: 'sourcekit-host-lock-unavailable-test' }
});
assert.ok(heldLock, 'expected test to acquire sourcekit host lock');
try {
  const output = await provider.run(ctx, { documents: [document], targets: [target] });
  assert.deepEqual(output.byChunkUid || {}, {}, 'expected sourcekit provider to skip run when host lock is unavailable');
  const checks = Array.isArray(output?.diagnostics?.checks) ? output.diagnostics.checks : [];
  assert.ok(
    checks.some((check) => check?.name === 'sourcekit_host_lock_unavailable'),
    'expected sourcekit host lock unavailable check'
  );
} finally {
  await heldLock.release();
}

console.log('sourcekit provider host lock unavailable test passed');

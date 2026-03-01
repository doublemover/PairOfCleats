#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  __setGitCommandRunnerForTests,
  DEFAULT_MIRROR_REFRESH_MS,
  resolveMirrorCacheRoot,
  resolveMirrorRefreshMs,
  resolveMirrorRepoPath,
  shouldRefreshMirror,
  tryMirrorClone
} from '../../../tools/bench/language/repos.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-language-mirror-cache-'));
const reposRoot = path.join(tempRoot, 'repos');
const mirrorRoot = resolveMirrorCacheRoot({ reposRoot });
const mirrorRepoPath = resolveMirrorRepoPath({
  mirrorCacheRoot: mirrorRoot,
  repo: 'example-org/example-repo'
});

assert.equal(
  mirrorRoot,
  path.join(path.resolve(reposRoot), '.mirror-cache'),
  'expected mirror cache root to live under repos root'
);
assert.equal(
  mirrorRepoPath.endsWith(`example-org__example-repo.git`),
  true,
  'expected mirror path to include normalized repo slug'
);

assert.equal(
  shouldRefreshMirror({ mirrorPath: mirrorRepoPath, refreshMs: DEFAULT_MIRROR_REFRESH_MS }),
  true,
  'missing mirror should be refreshable'
);

await fs.mkdir(mirrorRepoPath, { recursive: true });
const now = new Date();
await fs.utimes(mirrorRepoPath, now, now);
assert.equal(
  shouldRefreshMirror({ mirrorPath: mirrorRepoPath, refreshMs: 10 * 60 * 1000 }),
  false,
  'recent mirror should not refresh before interval'
);

const staleDate = new Date(Date.now() - (2 * 60 * 60 * 1000));
await fs.utimes(mirrorRepoPath, staleDate, staleDate);
assert.equal(
  shouldRefreshMirror({ mirrorPath: mirrorRepoPath, refreshMs: 60 * 60 * 1000 }),
  true,
  'stale mirror should refresh after interval'
);

assert.equal(resolveMirrorRefreshMs('60000'), 60000, 'expected numeric mirror refresh override');
assert.equal(resolveMirrorRefreshMs('0'), 0, 'expected explicit zero mirror refresh override');
assert.equal(
  resolveMirrorRefreshMs(null, 1234),
  1234,
  'expected null mirror refresh override to use fallback'
);
assert.equal(
  resolveMirrorRefreshMs(undefined, 1234),
  1234,
  'expected undefined mirror refresh override to use fallback'
);
assert.equal(
  resolveMirrorRefreshMs('invalid', 1234),
  1234,
  'expected fallback mirror refresh value for invalid input'
);

const shouldFallbackToDirectClone = (mirrorCloneResult) => (
  mirrorCloneResult?.attempted === true && mirrorCloneResult?.ok !== true
);

try {
  __setGitCommandRunnerForTests((cmd, args) => {
    if (cmd !== 'git') throw new Error(`unexpected command: ${cmd}`);
    if (Array.isArray(args) && args[0] === '--version') {
      return { ok: true, status: 0, stdout: 'git version 2.46.0', stderr: '' };
    }
    if (Array.isArray(args) && args[0] === 'clone' && args[1] === '--mirror') {
      const error = new Error('mirror clone timeout');
      error.code = 'ETIMEDOUT';
      error.shortMessage = 'mirror clone timed out';
      throw error;
    }
    throw new Error(`unexpected git args: ${Array.isArray(args) ? args.join(' ') : ''}`);
  });
  const timeoutResult = tryMirrorClone({
    repo: 'example-org/timeout-repo',
    repoPath: path.join(tempRoot, 'timeout-repo'),
    mirrorCacheRoot: mirrorRoot,
    timeoutMs: 17
  });
  assert.equal(timeoutResult.ok, false, 'expected mirror timeout to fail mirror clone');
  assert.equal(timeoutResult.attempted, true, 'expected mirror timeout to report attempted mirror clone');
  assert.equal(timeoutResult.mirrorAction, 'clone-timeout', 'expected timeout action from mirror clone');
  assert.match(timeoutResult.reason, /timed out after 17ms/i, 'expected timeout reason to include timeout duration');
  assert.equal(shouldFallbackToDirectClone(timeoutResult), true, 'expected mirror timeout to trigger direct clone fallback');

  __setGitCommandRunnerForTests((cmd, args) => {
    if (cmd !== 'git') throw new Error(`unexpected command: ${cmd}`);
    if (Array.isArray(args) && args[0] === '--version') {
      return { ok: true, status: 0, stdout: 'git version 2.46.0', stderr: '' };
    }
    if (Array.isArray(args) && args[0] === 'clone' && args[1] === '--mirror') {
      return { ok: false, status: 128, stdout: '', stderr: 'fatal: mirror fetch failed' };
    }
    throw new Error(`unexpected git args: ${Array.isArray(args) ? args.join(' ') : ''}`);
  });
  const cloneErrorResult = tryMirrorClone({
    repo: 'example-org/error-repo',
    repoPath: path.join(tempRoot, 'error-repo'),
    mirrorCacheRoot: mirrorRoot,
    timeoutMs: 25
  });
  assert.equal(cloneErrorResult.ok, false, 'expected mirror command failure to fail mirror clone');
  assert.equal(cloneErrorResult.attempted, true, 'expected mirror command failure to report attempted mirror clone');
  assert.equal(cloneErrorResult.mirrorAction, 'clone-failed', 'expected non-timeout mirror clone failure action');
  assert.match(cloneErrorResult.reason, /mirror clone failed/i, 'expected command failure reason prefix');
  assert.match(cloneErrorResult.reason, /fatal: mirror fetch failed/i, 'expected command failure details in reason');
  assert.equal(shouldFallbackToDirectClone(cloneErrorResult), true, 'expected mirror command failure to trigger direct clone fallback');

  const refreshRepo = 'example-org/refresh-timeout-repo';
  const refreshMirrorPath = resolveMirrorRepoPath({
    mirrorCacheRoot: mirrorRoot,
    repo: refreshRepo
  });
  await fs.mkdir(refreshMirrorPath, { recursive: true });
  __setGitCommandRunnerForTests((cmd, args) => {
    if (cmd !== 'git') throw new Error(`unexpected command: ${cmd}`);
    if (Array.isArray(args) && args[0] === '--version') {
      return { ok: true, status: 0, stdout: 'git version 2.46.0', stderr: '' };
    }
    if (Array.isArray(args) && args[0] === '-C' && args[2] === 'remote' && args[3] === 'update') {
      const error = new Error('mirror refresh timeout');
      error.code = 'ETIMEDOUT';
      throw error;
    }
    throw new Error(`unexpected git args: ${Array.isArray(args) ? args.join(' ') : ''}`);
  });
  const refreshTimeoutResult = tryMirrorClone({
    repo: refreshRepo,
    repoPath: path.join(tempRoot, 'refresh-timeout-repo'),
    mirrorCacheRoot: mirrorRoot,
    mirrorRefreshMs: 0,
    timeoutMs: 23
  });
  assert.equal(refreshTimeoutResult.ok, false, 'expected mirror refresh timeout to fail mirror clone');
  assert.equal(refreshTimeoutResult.attempted, true, 'expected mirror refresh timeout to report attempted mirror clone');
  assert.equal(refreshTimeoutResult.mirrorAction, 'refresh-timeout', 'expected timeout action from mirror refresh');
  assert.match(
    refreshTimeoutResult.reason,
    /timed out after 23ms/i,
    'expected mirror refresh timeout reason to include timeout duration'
  );
  assert.equal(
    shouldFallbackToDirectClone(refreshTimeoutResult),
    true,
    'expected mirror refresh timeout to trigger direct clone fallback'
  );
} finally {
  __setGitCommandRunnerForTests(null);
}

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('bench-language mirror cache test passed');

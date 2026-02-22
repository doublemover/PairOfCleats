#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_MIRROR_REFRESH_MS,
  resolveMirrorCacheRoot,
  resolveMirrorRefreshMs,
  resolveMirrorRepoPath,
  shouldRefreshMirror
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
assert.equal(
  resolveMirrorRefreshMs('invalid', 1234),
  1234,
  'expected fallback mirror refresh value for invalid input'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('bench-language mirror cache test passed');

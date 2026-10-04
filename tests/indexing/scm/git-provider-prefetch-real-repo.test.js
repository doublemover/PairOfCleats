#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
import { prepareScmFileMetaSnapshot } from '../../../src/index/scm/file-meta-snapshot.js';
import { getScmRuntimeConfig, setScmRuntimeConfig } from '../../../src/index/scm/runtime.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), `git-prefetch-real-${process.pid}-${Date.now()}`);
const repoRoot = path.join(root, 'repo');
const hookDir = path.join(root, 'empty-hooks');
const priorConfig = getScmRuntimeConfig();
const files = ['src/with space.js', 'src/plain.js', 'src/文字.js', 'src/emoji-🦀.js'];
const git = (args) => execFileSync('git', ['-c', `core.hooksPath=${hookDir}`, ...args],
  { encoding: 'utf8', timeout: 5000, env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
await fs.mkdir(hookDir, { recursive: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
try {
  git(['init', '--quiet', repoRoot]);
  for (const file of files) await fs.writeFile(path.join(repoRoot, file), 'export const fixture = 1;\n');
  git(['-C', repoRoot, 'add', '--', ...files]);
  git(['-C', repoRoot, '-c', 'user.name=Fixture Author', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Fixture metadata']);
  const headId = git(['-C', repoRoot, 'rev-parse', 'HEAD']);
  setScmRuntimeConfig({ repoRoot, repoHeadId: headId, maxConcurrentProcesses: 1,
    gitMetaBatch: { prefetchCacheMaxEntries: 2 } });
  const input = { repoRoot, headId, filesPosix: files, timeoutMs: 5000, includeChurn: false };
  const fetched = await gitProvider.getFileMetaBatch(input);
  for (const file of files) {
    assert.equal(fetched.fileMetaByPath[file].lastCommitId, headId);
    assert.equal(fetched.fileMetaByPath[file].lastAuthor, 'Fixture Author');
    assert.equal(Date.parse(fetched.fileMetaByPath[file].lastModifiedAt), Date.parse('2026-01-01T00:00:00Z'));
  }
  const cached = await gitProvider.getFileMetaBatch(input);
  assert.deepEqual(cached.fileMetaByPath, fetched.fileMetaByPath, 'same-head prefetch preserves metadata');
  const snapshotInput = { repoRoot, repoCacheRoot: path.join(root, 'snapshot'), provider: 'git', providerImpl: gitProvider,
    repoProvenance: { head: { commitId: headId }, dirty: false }, filesPosix: files,
    timeoutMs: 5000, includeChurn: false, maxFallbackConcurrency: 1 };
  const snapshot = await prepareScmFileMetaSnapshot(snapshotInput);
  assert.equal(snapshot.stats.fetched, files.length);
  assert.equal(snapshot.stats.source, 'fresh');
  const reused = await prepareScmFileMetaSnapshot(snapshotInput);
  assert.equal(reused.stats.reused, files.length);
  assert.equal(reused.stats.fetched, 0);
  assert.equal(reused.stats.source, 'cache');
  console.log('Real generated Git repository retains space/Unicode metadata through enabled prefetch and snapshot reuse.');
} finally {
  setScmRuntimeConfig(priorConfig);
  await fs.rm(root, { recursive: true, force: true });
}

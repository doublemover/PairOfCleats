#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prepareScmFileMetaSnapshot, resolveScmFileMetaSnapshotPath } from '../../../src/index/scm/file-meta-snapshot.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const cacheRoot = path.join(process.cwd(), '.testCache', 'scm-file-meta-snapshot-reuse');
const repoRoot = path.join(cacheRoot, 'repo');
fs.rmSync(cacheRoot, { recursive: true, force: true });
fs.mkdirSync(repoRoot, { recursive: true });

const files = ['src/a.js', 'src/b.js', 'src/c.js'];
let head = 'headA';
let changedCalls = 0;
const batchCalls = [];
const providerImpl = {
  async getChangedFiles({ fromRef, toRef }) {
    changedCalls += 1;
    if (fromRef === 'headA' && toRef === 'headB') {
      return { filesPosix: ['src/b.js'] };
    }
    return { filesPosix: [] };
  },
  async getFileMetaBatch({ filesPosix }) {
    const normalized = Array.isArray(filesPosix) ? filesPosix.slice().sort((a, b) => a.localeCompare(b)) : [];
    batchCalls.push(normalized);
    const fileMetaByPath = Object.create(null);
    for (const rel of normalized) {
      fileMetaByPath[rel] = {
        lastModifiedAt: head === 'headA' ? '2026-01-01T00:00:00Z' : '2026-01-02T00:00:00Z',
        lastAuthor: `${head}:${rel}`
      };
    }
    return { fileMetaByPath };
  },
  async getFileMeta() {
    throw new Error('fallback path should not be used');
  }
};

try {
  const first = await prepareScmFileMetaSnapshot({
    repoCacheRoot: cacheRoot,
    provider: 'git',
    providerImpl,
    repoRoot,
    repoProvenance: { head: { commitId: 'headA' }, dirty: false },
    filesPosix: files,
    includeChurn: false
  });
  assert.equal(first.stats.fetched, 3, 'expected first snapshot to fetch all files');
  assert.equal(first.stats.reused, 0, 'expected first snapshot to reuse nothing');
  assert.equal(first.fileMetaByPath['src/a.js'].lastAuthor, 'headA:src/a.js');

  head = 'headB';
  const second = await prepareScmFileMetaSnapshot({
    repoCacheRoot: cacheRoot,
    provider: 'git',
    providerImpl,
    repoRoot,
    repoProvenance: { head: { commitId: 'headB' }, dirty: false },
    filesPosix: files,
    includeChurn: false
  });
  assert.equal(second.stats.reused, 2, 'expected changed-files reuse for unchanged entries');
  assert.equal(second.stats.fetched, 1, 'expected only changed file to be refetched');
  assert.equal(second.fileMetaByPath['src/a.js'].lastAuthor, 'headA:src/a.js');
  assert.equal(second.fileMetaByPath['src/b.js'].lastAuthor, 'headB:src/b.js');

  const third = await prepareScmFileMetaSnapshot({
    repoCacheRoot: cacheRoot,
    provider: 'git',
    providerImpl,
    repoRoot,
    repoProvenance: { head: { commitId: 'headB' }, dirty: false },
    filesPosix: files,
    includeChurn: false
  });
  assert.equal(third.stats.source, 'cache', 'expected full cache reuse at same head');
  assert.equal(third.stats.fetched, 0, 'expected no fetches at same head');

  assert.equal(changedCalls >= 1, true, 'expected changed-files provider call');
  assert.deepEqual(batchCalls[0], ['src/a.js', 'src/b.js', 'src/c.js']);
  assert.deepEqual(batchCalls[1], ['src/b.js']);

  const snapshotPath = resolveScmFileMetaSnapshotPath(cacheRoot);
  assert.equal(fs.existsSync(snapshotPath), true, 'expected snapshot file to persist');
} finally {
  fs.rmSync(cacheRoot, { recursive: true, force: true });
}

console.log('scm file meta snapshot reuse test passed');

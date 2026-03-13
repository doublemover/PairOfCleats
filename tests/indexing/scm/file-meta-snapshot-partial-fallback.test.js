#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prepareScmFileMetaSnapshot } from '../../../src/index/scm/file-meta-snapshot.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const cacheRoot = resolveTestCachePath(process.cwd(), 'scm-file-meta-snapshot-partial-fallback');
const repoRoot = path.join(cacheRoot, 'repo');
const files = ['src/a.js', 'src/b.js'];

fs.rmSync(cacheRoot, { recursive: true, force: true });
fs.mkdirSync(repoRoot, { recursive: true });
for (const rel of files) {
  const abs = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `// ${rel}\n`, 'utf8');
}

const batchCalls = [];
const perFileCalls = [];
const providerImpl = {
  async getFileMetaBatch({ filesPosix, includeChurn }) {
    batchCalls.push({
      filesPosix: Array.isArray(filesPosix) ? filesPosix.slice().sort() : [],
      includeChurn
    });
    return {
      fileMetaByPath: {
        'src/a.js': {
          lastCommitId: 'commit-a',
          lastModifiedAt: '2026-03-06T00:00:00Z',
          lastAuthor: 'batch-author-a',
          churn: 7,
          churnAdded: 5,
          churnDeleted: 2,
          churnCommits: 2
        },
        'src/b.js': {
          lastCommitId: 'commit-b',
          lastModifiedAt: '2026-03-06T00:00:00Z',
          lastAuthor: 'batch-author-b',
          churn: null,
          churnAdded: null,
          churnDeleted: null,
          churnCommits: null
        }
      }
    };
  },
  async getFileMeta({ filePosix, includeChurn }) {
    perFileCalls.push({ filePosix, includeChurn });
    return {
      lastCommitId: 'commit-b',
      lastModifiedAt: '2026-03-06T00:00:00Z',
      lastAuthor: 'fallback-author-b',
      churn: 11,
      churnAdded: 8,
      churnDeleted: 3,
      churnCommits: 3
    };
  }
};

try {
  const snapshot = await prepareScmFileMetaSnapshot({
    repoCacheRoot: cacheRoot,
    provider: 'git',
    providerImpl,
    repoRoot,
    repoProvenance: { head: { commitId: 'headA' }, dirty: false },
    filesPosix: files,
    includeChurn: true,
    timeoutMs: 15000
  });

  assert.equal(batchCalls.length, 1, 'expected one batch fetch');
  assert.deepEqual(batchCalls[0], {
    filesPosix: ['src/a.js', 'src/b.js'],
    includeChurn: true
  });
  assert.deepEqual(perFileCalls, [
    { filePosix: 'src/b.js', includeChurn: true }
  ]);
  assert.equal(snapshot?.stats?.source, 'fresh-fallback');
  assert.equal(snapshot?.fileMetaByPath?.['src/a.js']?.lastAuthor, 'batch-author-a');
  assert.equal(snapshot?.fileMetaByPath?.['src/b.js']?.lastAuthor, 'fallback-author-b');
  assert.equal(snapshot?.fileMetaByPath?.['src/b.js']?.churnAdded, 8);
  assert.equal(snapshot?.fileMetaByPath?.['src/b.js']?.churnDeleted, 3);
  assert.equal(snapshot?.fileMetaByPath?.['src/b.js']?.churnCommits, 3);
} finally {
  fs.rmSync(cacheRoot, { recursive: true, force: true });
}

console.log('scm file-meta snapshot partial fallback test passed');

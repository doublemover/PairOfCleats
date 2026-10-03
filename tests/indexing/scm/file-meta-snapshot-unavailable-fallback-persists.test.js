#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prepareScmFileMetaSnapshot } from '../../../src/index/scm/file-meta-snapshot.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const cacheRoot = resolveTestCachePath(process.cwd(), 'scm-file-meta-snapshot-unavailable-fallback-persists');
const repoRoot = path.join(cacheRoot, 'repo');
const files = ['src/a.js', 'src/b.js'];

fs.rmSync(cacheRoot, { recursive: true, force: true });
fs.mkdirSync(repoRoot, { recursive: true });
for (const rel of files) {
  const abs = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `// ${rel}\n`, 'utf8');
}

const providerImpl = {
  async getFileMetaBatch() {
    return {
      ok: false,
      reason: 'unavailable'
    };
  },
  async getFileMeta({ filePosix }) {
    if (filePosix === 'src/b.js') {
      return { ok: false, reason: 'unavailable' };
    }
    return {
      lastCommitId: 'commit-a',
      lastModifiedAt: '2026-03-06T00:00:00Z',
      lastAuthor: 'fallback-author-a',
      churn: 7,
      churnAdded: 5,
      churnDeleted: 2,
      churnCommits: 2
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

  assert.equal(snapshot?.stats?.source, 'fallback');
  assert.equal(snapshot?.stats?.reuse?.countsByCause?.provider_unavailable, 1, 'expected unresolved provider failures to remain fallback debt');
  assert.equal(snapshot?.fileMetaByPath?.['src/a.js']?.lastAuthor, 'fallback-author-a');
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot?.fileMetaByPath || {}, 'src/b.js'), false);
} finally {
  fs.rmSync(cacheRoot, { recursive: true, force: true });
}

console.log('scm file-meta snapshot unavailable fallback persists test passed');

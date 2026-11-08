import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareScmFileMetaSnapshot } from '../../../src/index/scm/file-meta-snapshot.js';
import { buildScmFreshnessGuard } from '../../../src/index/scm/runtime.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scm-authority-'));
let healthy = true, head = 'A', calls = 0;
const providerImpl = {
  getHistoryAffectedFiles: async () => ({ ok: false, reason: 'unavailable' }),
  getFileMetaBatch: async ({ filesPosix }) => {
    calls += 1;
    return healthy ? { fileMetaByPath: Object.fromEntries(filesPosix.map(file => [file, {
      lastCommitId: head, lastAuthor: head, lastModifiedAt: '2026-10-21T00:00:00Z'
    }])) } : { ok: false, reason: 'unavailable' };
  },
  getFileMeta: async () => ({ ok: false, reason: 'unavailable' })
};
const run = () => prepareScmFileMetaSnapshot({ repoCacheRoot: root, repoRoot: root,
  provider: 'git', providerImpl, filesPosix: ['a.js'],
  repoProvenance: { head: { commitId: head }, dirty: false }, includeChurn: false });
try {
  assert.equal((await run()).fileMetaByPath['a.js'].lastAuthor, 'A');
  head = 'B'; healthy = false;
  const failed = await run();
  assert.equal(failed.fileMetaByPath['a.js']?.lastAuthor ?? null, null);
  assert.equal(failed.stats.unresolvedFiles, 1);
  healthy = true;
  assert.equal((await run()).fileMetaByPath['a.js'].lastAuthor, 'B');
  assert.equal(calls, 3, 'failed refresh must remain eligible for recovery');
  const guard = commitId => buildScmFreshnessGuard({ provider: 'jj', repoRoot: root,
    repoProvenance: { head: { commitId, changeId: 'same-change' } } }).key;
  assert.notEqual(guard('version-A'), guard('version-B'));
  assert.equal(guard('version-A'), guard('version-A'));
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('SCM metadata generation authority passed');

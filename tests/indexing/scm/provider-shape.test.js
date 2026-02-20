#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assertScmProvider } from '../../../src/index/scm/provider.js';

const wrapped = assertScmProvider({
  name: 'git',
  detect() {
    return { ok: true, provider: 'git', repoRoot: '/repo', detectedBy: 'git-root' };
  },
  listTrackedFiles() {
    return { filesPosix: ['b/file.js', 'a/file.js', 'a/file.js'] };
  },
  getRepoProvenance() {
    return {
      provider: 'git',
      root: '/repo',
      head: {
        commitId: 'abc123',
        branch: 'main',
        bookmarks: ['z', 'a']
      },
      dirty: false,
      detectedBy: 'git-root'
    };
  },
  getChangedFiles() {
    return { filesPosix: ['src/z.js', 'src/a.js'] };
  },
  getFileMeta() {
    return { churn: 4, churnAdded: 3, churnDeleted: 1, churnCommits: 2 };
  },
  annotate() {
    return {
      lines: [
        { line: 2, author: 'b' },
        { line: 1, author: 'a' }
      ]
    };
  }
});

const tracked = await wrapped.listTrackedFiles({ repoRoot: '/repo' });
assert.deepEqual(tracked.filesPosix, ['a/file.js', 'b/file.js']);

const changed = await wrapped.getChangedFiles({ repoRoot: '/repo' });
assert.deepEqual(changed.filesPosix, ['src/a.js', 'src/z.js']);

const provenance = await wrapped.getRepoProvenance({ repoRoot: '/repo' });
assert.equal(provenance.provider, 'git');
assert.deepEqual(provenance.head.bookmarks, ['a', 'z']);

const meta = await wrapped.getFileMeta({ repoRoot: '/repo', filePosix: 'src/a.js' });
assert.equal(meta.churn, 4);
assert.equal(meta.lastModifiedAt, null);

const annotate = await wrapped.annotate({ repoRoot: '/repo', filePosix: 'src/a.js', timeoutMs: 10 });
assert.deepEqual(annotate.lines.map((entry) => entry.line), [1, 2]);

console.log('scm provider shape test passed');

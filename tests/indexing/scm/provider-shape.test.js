#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assertScmProvider } from '../../../src/index/scm/provider.js';

const gitWrapped = assertScmProvider({
  name: 'git',
  adapter: 'parity',
  metadataCapabilities: {
    author: true,
    time: true,
    branch: true,
    churn: true,
    commitId: true
  },
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
        changeId: 'should-be-gated',
        branch: 'main',
        bookmarks: ['z', 'a']
      },
      dirty: false,
      detectedBy: 'git-root',
      commit: 'abc123',
      branch: 'main',
      bookmarks: ['z', 'a']
    };
  },
  getChangedFiles() {
    return { filesPosix: ['src/z.js', 'src/a.js'] };
  },
  getFileMeta() {
    return {
      lastCommitId: 'abc123',
      lastModifiedAt: '2026-01-01T00:00:00Z',
      lastAuthor: 'Ada',
      churn: 4,
      churnAdded: 3,
      churnDeleted: 1,
      churnCommits: 2
    };
  },
  getFileMetaBatch() {
    return {
      fileMetaByPath: {
        'src/z.js': { churn: 1, lastAuthor: 'z-author', lastCommitId: 'zzz111' },
        'src/a.js': { churnAdded: 2, churnDeleted: 3, lastModifiedAt: '2026-01-02T00:00:00Z' }
      }
    };
  },
  annotate() {
    return {
      lines: [
        { line: 2, author: 'b', commitId: 'b2' },
        { line: 1, author: 'a', commitId: 'a1' }
      ]
    };
  }
});

assert.equal(gitWrapped.adapter, 'parity');
assert.equal(gitWrapped.metadataCapabilities.branch, true);
assert.equal(gitWrapped.metadataCapabilities.changeId, false);

const tracked = await gitWrapped.listTrackedFiles({ repoRoot: '/repo' });
assert.deepEqual(tracked.filesPosix, ['a/file.js', 'b/file.js']);

const changed = await gitWrapped.getChangedFiles({ repoRoot: '/repo' });
assert.deepEqual(changed.filesPosix, ['src/a.js', 'src/z.js']);

const provenance = await gitWrapped.getRepoProvenance({ repoRoot: '/repo' });
assert.equal(provenance.provider, 'git');
assert.equal(provenance.head.commitId, 'abc123');
assert.equal(provenance.head.branch, 'main');
assert.equal(provenance.head.changeId, null);
assert.equal(provenance.head.bookmarks, null);
assert.equal(provenance.bookmarks, null);

const meta = await gitWrapped.getFileMeta({ repoRoot: '/repo', filePosix: 'src/a.js' });
assert.equal(meta.churn, 4);
assert.equal(meta.lastCommitId, 'abc123');
assert.equal(meta.lastModifiedAt, '2026-01-01T00:00:00Z');
assert.equal(meta.lastAuthor, 'Ada');

const batchMeta = await gitWrapped.getFileMetaBatch({
  repoRoot: '/repo',
  filesPosix: ['src/z.js', 'src/a.js']
});
assert.equal(batchMeta.fileMetaByPath['src/z.js'].lastAuthor, 'z-author');
assert.equal(batchMeta.fileMetaByPath['src/a.js'].churnAdded, 2);
assert.equal(batchMeta.fileMetaByPath['src/a.js'].churnDeleted, 3);

const annotate = await gitWrapped.annotate({ repoRoot: '/repo', filePosix: 'src/a.js', timeoutMs: 10 });
assert.deepEqual(annotate.lines.map((entry) => entry.line), [1, 2]);
assert.equal(annotate.lines[0].commitId, null);

const jjWrapped = assertScmProvider({
  name: 'jj',
  adapter: 'experimental',
  metadataCapabilities: {
    author: true,
    time: true,
    branch: false,
    churn: false,
    commitId: true,
    changeId: true,
    operationId: true,
    bookmarks: true
  },
  detect() {
    return { ok: true, provider: 'jj', repoRoot: '/repo', detectedBy: 'jj-root' };
  },
  listTrackedFiles() {
    return { filesPosix: ['src/main.js'] };
  },
  getRepoProvenance() {
    return {
      provider: 'jj',
      root: '/repo',
      head: {
        commitId: 'jjc1',
        changeId: 'jjchg1',
        operationId: 'jjop1',
        branch: 'main',
        bookmarks: ['beta', 'alpha'],
        author: 'Jess',
        timestamp: '2026-01-03T00:00:00Z'
      },
      dirty: true,
      detectedBy: 'jj-root',
      commit: 'jjc1',
      branch: 'main',
      bookmarks: ['beta', 'alpha']
    };
  },
  getChangedFiles() {
    return { filesPosix: ['src/main.js'] };
  },
  getFileMeta() {
    return {
      lastCommitId: 'jjc1',
      lastModifiedAt: '2026-01-03T00:00:00Z',
      lastAuthor: 'Jess',
      churn: 99,
      churnAdded: 33,
      churnDeleted: 66,
      churnCommits: 9
    };
  },
  getFileMetaBatch() {
    return {
      fileMetaByPath: {
        'src/main.js': {
          lastCommitId: 'jjc1',
          lastModifiedAt: '2026-01-03T00:00:00Z',
          lastAuthor: 'Jess',
          churn: 99
        }
      }
    };
  },
  annotate() {
    return {
      lines: [
        { line: 1, author: 'Jess', commitId: 'jjc1' }
      ]
    };
  }
});

assert.equal(jjWrapped.adapter, 'experimental');
const jjProvenance = await jjWrapped.getRepoProvenance({ repoRoot: '/repo' });
assert.equal(jjProvenance.head.branch, null);
assert.deepEqual(jjProvenance.head.bookmarks, ['alpha', 'beta']);
assert.equal(jjProvenance.head.changeId, 'jjchg1');
assert.equal(jjProvenance.branch, null);
assert.deepEqual(jjProvenance.bookmarks, ['alpha', 'beta']);

const jjMeta = await jjWrapped.getFileMeta({ repoRoot: '/repo', filePosix: 'src/main.js' });
assert.equal(jjMeta.lastCommitId, 'jjc1');
assert.equal(jjMeta.lastAuthor, 'Jess');
assert.equal(jjMeta.churn, null);
assert.equal(jjMeta.churnAdded, null);

const jjBatch = await jjWrapped.getFileMetaBatch({ repoRoot: '/repo', filesPosix: ['src/main.js'] });
assert.equal(jjBatch.fileMetaByPath['src/main.js'].lastCommitId, 'jjc1');
assert.equal(jjBatch.fileMetaByPath['src/main.js'].churn, null);

const jjAnnotate = await jjWrapped.annotate({ repoRoot: '/repo', filePosix: 'src/main.js', timeoutMs: 10 });
assert.equal(jjAnnotate.lines[0].author, 'Jess');
assert.equal(jjAnnotate.lines[0].commitId, null);

console.log('scm provider shape test passed');

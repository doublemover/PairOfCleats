#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assertScmProvider } from '../../../src/index/scm/provider.js';

const wrapped = assertScmProvider({
  name: 'jj',
  detect() {
    throw new Error('detect boom');
  },
  listTrackedFiles() {
    throw new Error('ls boom');
  },
  getRepoProvenance() {
    throw new Error('prov boom');
  },
  getChangedFiles() {
    throw new Error('changed boom');
  },
  getFileMeta() {
    throw new Error('meta boom');
  },
  annotate() {
    throw new Error('annotate boom');
  }
});

assert.deepEqual(wrapped.detect({ startPath: process.cwd() }), { ok: false });
assert.deepEqual(await wrapped.listTrackedFiles({ repoRoot: '/repo' }), { ok: false, reason: 'unavailable' });
assert.deepEqual(await wrapped.getChangedFiles({ repoRoot: '/repo' }), { ok: false, reason: 'unavailable' });
assert.deepEqual(await wrapped.getFileMeta({ repoRoot: '/repo', filePosix: 'a.js' }), { ok: false, reason: 'unavailable' });
assert.deepEqual(await wrapped.annotate({ repoRoot: '/repo', filePosix: 'a.js', timeoutMs: 10 }), { ok: false, reason: 'unavailable' });

const provenance = await wrapped.getRepoProvenance({ repoRoot: '/repo' });
assert.equal(provenance.provider, 'jj');
assert.equal(provenance.root, '/repo');
assert.equal(provenance.head, null);
assert.equal(provenance.dirty, null);

console.log('scm unavailable deterministic failure test passed');

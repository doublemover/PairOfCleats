import assert from 'node:assert/strict';
import { runGitMetaPrefetchTask, createGitMetaPrefetchEntry, mergeGitMetaPrefetchEntry,
  buildGitMetaBatchResponseFromEntry } from '../../../src/index/scm/providers/git/prefetch.js';
const guard = { key: 'task-owned-disjoint-coverage' };
const entry = createGitMetaPrefetchEntry(guard), fetched = [];
const request = files => runGitMetaPrefetchTask(guard, async () => {
  const missing = files.filter(file => !entry.knownFiles.has(file));
  if (missing.length) {
    fetched.push(missing);
    await new Promise(resolve => setImmediate(resolve));
    mergeGitMetaPrefetchEntry({ entry, filesPosix: missing, fileMetaByPath:
      Object.fromEntries(missing.map(file => [file, { lastAuthor: file, lastModifiedAt: '2026-10-21T00:00:00Z' }])) });
  }
  return buildGitMetaBatchResponseFromEntry({ entry, filesPosix: files });
});
const [a,b,c] = await Promise.all([request(['a.js']), request(['b.js']), request(['a.js','b.js','c.js'])]);
assert.equal(a.fileMetaByPath['a.js'].lastAuthor, 'a.js');
assert.equal(b.fileMetaByPath['b.js'].lastAuthor, 'b.js');
assert.equal(c.fileMetaByPath['c.js'].lastAuthor, 'c.js');
assert.deepEqual(fetched, [['a.js'], ['b.js'], ['c.js']]);
console.log('Git prefetch caller coverage passed');

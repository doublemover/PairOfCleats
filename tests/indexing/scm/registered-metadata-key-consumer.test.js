import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertScmProvider } from '../../../src/index/scm/provider.js';
import { getScmProvider } from '../../../src/index/scm/registry.js';
import { prepareScmFileMetaSnapshot } from '../../../src/index/scm/file-meta-snapshot.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { buildDependencySignatures } from '../../../src/index/build/indexer/signatures.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';
const { dir } = await prepareIsolatedTestCacheDir('registered-metadata-keys');
const keys = ['a.js', ' a.js', 'trailing.js ', '雪 😀.js', '__proto__'];
const values = Object.fromEntries(keys.map((key, index) => [key, { lastAuthor: 'author-' + index,
  lastCommitId: 'commit-' + index, lastModifiedAt: '2026-10-29T00:00:00Z', churn: index + 1 }]));
for (const reverse of [false, true]) {
  let requests = 0, fallback = 0;
  const source = { ...getScmProvider('git'),
    async getFileMetaBatch({ filesPosix }) {
      requests++; assert.deepEqual(filesPosix.slice().sort(), keys.slice().sort());
      return { fileMetaByPath: Object.fromEntries((reverse ? keys.toReversed() : keys).map(key => [key, values[key]])) };
    },
    async getFileMeta() { fallback++; assert.fail('complete exact batch metadata must not fall back'); }
  };
  const provider = assertScmProvider(source), cache = path.join(dir, String(reverse));
  const run = () => prepareScmFileMetaSnapshot({ repoRoot: dir, repoCacheRoot: cache, provider: 'git', providerImpl: provider,
    filesPosix: keys, includeChurn: true, repoProvenance: { head: { commitId: 'same-head' }, dirty: false } });
  const first = await run(), warm = await run();
  for (const key of keys) { assert.equal(first.fileMetaByPath[key].lastAuthor, values[key].lastAuthor);
    assert.equal(warm.fileMetaByPath[key].lastAuthor, values[key].lastAuthor); }
  assert.equal(requests, 1); assert.equal(fallback, 0);
  const filename = path.join(cache, 'scm', 'file-meta-v1.json');
  // Locate the actual snapshot without assuming the cache owner's directory layout.
  const find = async folder => { for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name); if (entry.isDirectory()) { const nested = await find(file); if (nested) return nested; }
    else if (entry.name === 'file-meta-v1.json') return file;
  } return null; };
  const actual = await find(cache); assert.ok(actual, filename);
  const stored = JSON.parse(await fs.readFile(actual, 'utf8')); assert.equal(stored.schemaVersion, 3);
  stored.schemaVersion = 2; await fs.writeFile(actual, JSON.stringify(stored));
  await run(); assert.equal(requests, 2, 'old collided-key snapshot generations cannot replay');
  const batch = await provider.getFileMetaBatch({ repoRoot: dir, filesPosix: keys });
  assert.equal(Object.getPrototypeOf(batch.fileMetaByPath), null);
  assert.equal(batch.fileMetaByPath.__proto__.lastAuthor, values.__proto__.lastAuthor);
  const hostile = assertScmProvider({ ...source, getFileMetaBatch: async () => ({ fileMetaByPath: {
    '../escape.js': values['a.js'], 'bad\0.js': values['a.js'], 'folder/../ a.js': values[' a.js'] } }) });
  assert.deepEqual(Object.keys((await hostile.getFileMetaBatch({ repoRoot: dir })).fileMetaByPath), [' a.js']);
}
const base = { repoProvenance: { provider: 'git', head: { commitId: 'A' } }, gitBlameEnabled: true };
let current = 'first'; const requests = [];
const incrementalProvider = assertScmProvider({ ...getScmProvider('git'),
  getHistoryAffectedFiles: async () => ({ complete: true, filesPosix: [' a.js'] }),
  getFileMetaBatch: async ({ filesPosix }) => { requests.push(filesPosix); return { fileMetaByPath: Object.fromEntries(filesPosix.map(file => [file,
    { lastCommitId: current, lastAuthor: current + ':' + file, lastModifiedAt: '2026-10-29T00:00:00Z' }])) }; },
  getFileMeta: async () => assert.fail('complete incremental metadata cannot borrow another file or need fallback') });
const incremental = () => prepareScmFileMetaSnapshot({ repoRoot: dir, repoCacheRoot: path.join(dir, 'invalidation'), provider: 'git',
  providerImpl: incrementalProvider, filesPosix: ['a.js', ' a.js'], repoProvenance: { head: { commitId: current }, dirty: false } });
await incremental(); current = 'second'; const refreshed = await incremental();
assert.deepEqual(requests, [['a.js', ' a.js'], [' a.js']]);
assert.equal(refreshed.fileMetaByPath['a.js'].lastAuthor, 'first:a.js');
assert.equal(refreshed.fileMetaByPath[' a.js'].lastAuthor, 'second: a.js');
assert.equal(SEMANTIC_ANALYSIS_VERSIONS.scmMetadata, '2');
assert.ok(buildDependencySignatures(base, 'code', 'fixture').enrichment);
console.log('Production SCM wrapper keys retain distinct authored metadata through immutable snapshot reuse, legacy invalidation and hostile path admission.');

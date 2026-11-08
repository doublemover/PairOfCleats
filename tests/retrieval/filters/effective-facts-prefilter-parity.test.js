import assert from 'node:assert/strict';
import { buildFilterIndex, hydrateFilterIndex, serializeFilterIndex } from '../../../src/retrieval/filter-index.js';
import { filterChunks } from '../../../src/retrieval/output.js';

const chunks = [
  { id: 0, file: 'src/my file,name.js', ext: '', last_author: 'Alice Smith, Jr',
    lang: 'wrong', metaV2: { lang: ' JavaScript ', visibility: 'private' },
    docmeta: { visibility: 'public', modifiers: ['private'] } },
  { id: 1, file: 'src/other.js', last_author: 'Alice', metaV2: { effective: { languageId: 'JavaScript' } } },
  { id: 2, file: 'src/needle-middle.py', last_author: 'Bob', lang: 'Python', docmeta: { modifiers: ['private'] } },
  { id: 3, file: 'docs/x.md', last_author: 'Carol' }
];
const raw = serializeFilterIndex(buildFilterIndex(chunks, { includeBitmaps: false }));
assert.equal(hydrateFilterIndex({ ...raw, factsVersion: 1 }), null, 'old persisted facts require rebuilding');
for (const index of [buildFilterIndex(chunks), hydrateFilterIndex(JSON.parse(JSON.stringify(raw)))]) {
  for (const [filters, expected] of [
    [{ file: 'my file,name.js' }, [0]],
    [{ author: 'Alice Smith, Jr' }, [0]],
    [{ file: ['my file,name.js', 'other.js'] }, [0, 1]],
    [{ file: '/needle|other/' }, [1, 2]],
    [{ file: ['other.js', '/needle/'] }, [1, 2]],
    [{ file: ['other.js', 'x'] }, [1, 3]],
    [{ file: 'middle' }, [2]],
    [{ ext: '.js', lang: 'javascript' }, [0, 1]],
    [{ visibility: 'public' }, [0]],
    [{ visibility: 'private' }, [2]]
  ]) {
    const ids = filterChunks(chunks, filters, index).map(chunk => chunk.id).sort();
    const exact = filterChunks(chunks, { ...filters, filePrefilter: { enabled: false } }, null).map(chunk => chunk.id).sort();
    assert.deepEqual(ids, expected, JSON.stringify(filters));
    assert.deepEqual(ids, exact, 'indexed pruning must retain every exact match');
  }
}
console.log('effective filter facts and file prefilter parity passed');

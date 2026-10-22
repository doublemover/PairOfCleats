import assert from 'node:assert/strict';
import { parseMetaFilters } from '../../../src/retrieval/filters.js';
import { matchMetaFilters } from '../../../src/retrieval/output/filters/meta.js';
import { createChunkFilterPredicate } from '../../../src/retrieval/output/filters.js';
const records = [{ internetExposed: false, count: 0 }, { internetExposed: true, count: 5 },
  { other: 'missing' }, { internetExposed: 'false', count: '0' }, { internetExposed: null, count: null }];
for (const [key, value] of [['internetExposed', false], ['count', 0]]) {
  for (const metaFilters of [parseMetaFilters(`${key}=${value}`), parseMetaFilters(null, JSON.stringify({ [key]: value }))]) {
    const chunks = records.map(record => ({ docmeta: { record } }));
    assert.deepEqual(chunks.map((chunk, index) => matchMetaFilters({ chunk, metaFilters }) ? index : null).filter(index => index != null), [0, 3]);
    const predicate = createChunkFilterPredicate({ meta: metaFilters });
    assert.deepEqual(chunks.map((chunk, index) => predicate(chunk) ? index : null).filter(index => index != null), [0, 3]);
  }
}
const nested = { docmeta: { record: { flags: { exposed: false }, counts: [0, 7], empty: '', missingValue: null } } };
assert.equal(matchMetaFilters({ chunk: nested, metaFilters: [{ key: 'flags.exposed', value: false }, { key: 'counts', value: 0 }] }), true);
assert.equal(matchMetaFilters({ chunk: nested, metaFilters: [{ key: 'absent', value: false }] }), false);
assert.equal(matchMetaFilters({ chunk: nested, metaFilters: [{ key: 'empty', value: '' }] }), false);
assert.equal(matchMetaFilters({ chunk: nested, metaFilters: [{ key: 'missingValue', value: null }] }), false);
console.log('false and zero metadata constraints preserve scalar and substring semantics');

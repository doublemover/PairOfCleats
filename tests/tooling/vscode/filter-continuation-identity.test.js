import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { normalizeFilterPagination, mergeFilterPage } = require('../../../extensions/vscode/filter-pagination.js');
const page = { kind: 'filter', generation: 'a'.repeat(64), hasMore: true, nextCursor: 'next', total: 5, returned: 1 };
assert.equal(normalizeFilterPagination({ ...page, generation: page.generation + '\n' }), null);
assert.equal(normalizeFilterPagination({ ...page, hasMore: 'true' }), null);
assert.equal(normalizeFilterPagination({ ...page, nextCursor: null }), null);
const previous = { pagination: page, hits: [{ section: 'records', id: 0, name: 'same' }] };
assert.throws(() => mergeFilterPage(previous, page, []), /did not advance/);
const merged = mergeFilterPage(previous, { ...page, hasMore: false, nextCursor: null }, [
  { section: 'records', id: 0, name: 'same' },
  { section: 'records', id: '0', name: 'same' },
  { section: 'records', chunkUid: '0', name: 'same' },
  { section: 'code', id: 0, name: 'same' }
]);
assert.equal(merged.length, 4);
assert.deepEqual(previous.hits, [{ section: 'records', id: 0, name: 'same' }]);
assert.deepEqual(merged.map(row => [row.section, row.id ?? row.chunkUid]),
  [['records', 0], ['records', '0'], ['records', '0'], ['code', 0]]);
console.log('Indexed page identity preserves type/domain/namespace and refuses nonadvancing cursors');

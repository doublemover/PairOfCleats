import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { normalizeFilterPagination, admitFilterPage, mergeFilterPage } = require('../../../extensions/vscode/filter-pagination.js');
const page = { kind: 'filter', generation: 'a'.repeat(64), hasMore: true, nextCursor: 'next', total: 5, returned: 1 };
assert.equal(normalizeFilterPagination({ ...page, generation: page.generation + '\n' }), null);
assert.equal(normalizeFilterPagination({ ...page, hasMore: 'true' }), null);
assert.equal(normalizeFilterPagination({ ...page, nextCursor: null }), null);
const previous = { pagination: page, hits: [{ section: 'records', id: 0, name: 'same' }] };
assert.throws(() => mergeFilterPage(previous, page, previous.hits), /did not advance/);
const merged = mergeFilterPage(previous, { ...page, returned: 4, hasMore: false, nextCursor: null }, [
  { section: 'records', id: 0, name: 'same' },
  { section: 'records', id: '0', name: 'same' },
  { section: 'records', chunkUid: '0', name: 'same' },
  { section: 'code', id: 0, name: 'same' }
]);
assert.equal(merged.length, 4);
assert.deepEqual(previous.hits, [{ section: 'records', id: 0, name: 'same' }]);
assert.deepEqual(merged.map(row => [row.section, row.id ?? row.chunkUid]),
  [['records', 0], ['records', '0'], ['records', '0'], ['code', 0]]);
for (const invalid of [{ ...page, returned: 0 }, { ...page, returned: '1' }, { ...page, total: 0 },
  { ...page, order: 'ranked-score' }, { ...page, hasMore: false }, { ...page, generation: null }]) {
  assert.throws(() => admitFilterPage(invalid, previous.hits), /invalid generation\/page membership/);
}
assert.throws(() => admitFilterPage({ ...page, returned: 0 }, []), /invalid generation\/page membership/);
assert.equal(admitFilterPage({ ...page, total: 0, returned: 0, hasMore: false, nextCursor: null }, []).returned, 0,
  'an explicitly complete empty page is admitted without claiming remaining matches');
assert.throws(() => mergeFilterPage(previous, { ...page, total: 6, nextCursor: 'advanced' }, previous.hits), /total changed/);
console.log('Indexed page identity preserves type/domain/namespace and refuses nonadvancing cursors');

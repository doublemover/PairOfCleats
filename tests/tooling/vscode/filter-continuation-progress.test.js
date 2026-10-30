import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mergeFilterPage, carryFilterPageHistory } = require('../../../extensions/vscode/filter-pagination.js');
const generation = 'a'.repeat(64);
const page = cursor => ({ kind: 'filter', generation, total: 10, returned: 1,
  hasMore: true, nextCursor: cursor });
const hit = id => ({ section: 'code', chunkUid: id, file: `${id}.js` });
const previous = { pagination: page('cursor-a'), hits: [hit('first')] };
const second = mergeFilterPage(previous, page('cursor-b'), [hit('second')]);
assert.deepEqual(second.map(value => value.chunkUid), ['first', 'second']);
const normalized = second.map(value => ({ ...value })); carryFilterPageHistory(second, normalized);
const retained = { pagination: page('cursor-b'), hits: normalized };
assert.throws(() => mergeFilterPage(retained, page('cursor-a'), [hit('third')]), /earlier cursor/);
assert.deepEqual(retained.hits.map(value => value.chunkUid), ['first', 'second']);
assert.throws(() => mergeFilterPage(retained, page('cursor-c'), [hit('first')]), /no new source identities/);

const completed = mergeFilterPage(retained, { ...page(null), returned: 0, hasMore: false }, []);
assert.deepEqual(completed, retained.hits, 'an explicitly complete empty final page remains a valid observation');
const unknown = mergeFilterPage(previous, page('cursor-b'), [{ file: 'unknown.js' }]);
const unknownPage = { pagination: page('cursor-b'), hits: unknown };
assert.throws(() => mergeFilterPage(unknownPage, page('cursor-a'), [{ file: 'another-unknown.js' }]), /earlier cursor/,
  'cursor progress does not invent source identity for otherwise unknown hits');

assert.throws(() => mergeFilterPage({ pagination: { ...page('cursor-a'), total: 2 }, hits: [hit('first')] },
  { ...page(null), total: 2, returned: 2, hasMore: false }, [hit('second'), hit('third')]), /loaded membership exceeds/);

// There is no fabricated process-local cursor history after serialization.
// Existing captured identities still reject an all-overlap page after restore.
const restored = JSON.parse(JSON.stringify(retained));
assert.throws(() => mergeFilterPage(restored, page('cursor-c'), [hit('first')]), /no new source identities/);
const restoredAdvanced = mergeFilterPage(restored, page('cursor-a'), [hit('third')]);
assert.equal(restoredAdvanced.length, 3);
assert.equal(JSON.stringify(restoredAdvanced).includes('cursor-a'), false, 'opaque progress bookkeeping is not a hit/source field');
console.log('Bounded original-array cursor cycle/membership progress controls authored; execution deferred.');

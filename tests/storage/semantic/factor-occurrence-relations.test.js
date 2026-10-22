import assert from 'node:assert/strict';
import { createOccurrenceRelation, sumOccurrenceRelations, productOccurrenceRelations, openOccurrenceCursor }
  from '../../../src/semantic/relations/factor.js';

const make = (name, role, rows) => createOccurrenceRelation({ world: { generation: 'same', dictionaryEpoch: 'one' },
  relationId: name, atomRoleId: role, schema: [{ name, type: 'string', nullable: true }], complete: true,
  rows: rows.map((value, i) => ({ occurrenceId: `o${i}`, supportId: 'source', tuple: [value], multiplicity: '1', sourceRef: { source: 'exact', span: [i, i + 1] } })) });
const left = make('x', 'R-left', ['a', 'a', null]), right = make('y', 'R-right', ['a', 'b']);
const product = productOccurrenceRelations([left, right]);
assert.equal(product.cardinality, '6');
const cursor = openOccurrenceCursor({ relation: product });
const all = [];
for (;;) {
  const page = cursor.next({ limit: 1 }); all.push(...page.items);
  if (page.state === 'exhausted') break;
}
assert.deepEqual(all.map(row => row.tuple), ['a', 'a', null].flatMap(x => ['a', 'b'].map(y => ({ x, y }))));
assert.equal(all.filter(row => row.tuple.x === 'a').length, 4, 'equal endpoints retain distinct occurrence bags');
assert.equal(all[0].occurrences.length, 2);
assert.throws(() => productOccurrenceRelations([left, left]), /disjoint/);
const sum = sumOccurrenceRelations([left, left]);
assert.equal(sum.cardinality, '6', 'sharing a physical child never deduplicates bag multiplicity');
const large = createOccurrenceRelation({ world: { generation: 'same', dictionaryEpoch: 'one' }, relationId: 'large', atomRoleId: 'large',
  schema: [{ name: 'z', type: 'integer', nullable: false }], complete: false,
  rows: [{ occurrenceId: 'large', supportId: 'independent', tuple: [1], multiplicity: '9007199254740993', sourceRef: null }] });
assert.equal(large.cardinality, '9007199254740993');
const largeCursor = openOccurrenceCursor({ relation: large });
assert.equal(largeCursor.next({ limit: 1 }).capturedDomainComplete, false);
const stopped = openOccurrenceCursor({ relation: product });
assert.equal(stopped.next({ workBudget: 0 }).offset, '0');
assert.equal(stopped.next({ maxBytes: 1 }).offset, '0');
assert.equal(stopped.next({ limit: 1 }).items[0].tuple.x, 'a');
assert.throws(() => stopped.next({ rootId: 'new-layout' }), /Incompatible/);
let released = 0; const leased = openOccurrenceCursor({ relation: left, release: () => released++ });
leased.close(); leased.close(); assert.equal(released, 1);
assert.throws(() => leased.next(), /closed/);
cursor.close(); stopped.close(); largeCursor.close();
console.log('lossless factor occurrence relation contract passed');

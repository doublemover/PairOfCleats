import assert from 'node:assert/strict';
import { createPageIdentityLookup, projectOutput, VIEW_LIMITS } from '../../../src/map/workspace/projection.js';

const first = { id: 'same', label: 'first original' }, second = { id: 'same', label: 'second original' };
const nodes = [first, second, { id: 0, label: 'number zero' }, { id: '0', label: 'string zero' }, { id: NaN }, { id: null }];
const lookup = createPageIdentityLookup({ nodes });
for (const id of ['same', 0, '0', NaN, null, undefined, 'absent']) {
  assert.equal(lookup.get(id), nodes.find(node => node.id === id));
  assert.equal(lookup.has(id), nodes.some(node => node.id === id));
}
assert.equal(lookup.get('same'), first); assert(Object.isFrozen(lookup));
assert.throws(() => createPageIdentityLookup({ nodes: new Array(VIEW_LIMITS.nodes + 1) }), /bounded/);

let idReads = 0;
const admitted = Array.from({ length: VIEW_LIMITS.nodes }, (_, index) => ({ get id() { idReads++; return `node:${index}`; }, label: `${index}` }));
const capped = createPageIdentityLookup({ nodes: admitted });
assert.equal(idReads, VIEW_LIMITS.nodes);
const edges = Array.from({ length: VIEW_LIMITS.edges }, (_, index) => ({ from: 'node:0', to: 'node:199', ordinal: index }));
for (let repeat = 0; repeat < 5; repeat++) {
  assert.equal(capped.get('node:0'), admitted[0]);
  assert.deepEqual(edges.map(edge => capped.get(edge.to).label), new Array(VIEW_LIMITS.edges).fill('199'));
}
assert.equal(idReads, VIEW_LIMITS.nodes, 'repeated current-page selection resolves endpoints without rescanning node IDs');

// Page, relation-scope and response replacement each receive a new lookup.
const map = { options: {}, summary: {}, nodes: Array.from({ length: 202 }, (_, index) => ({ path: `${index}.js`, name: `Original ${index}`, members: [] })),
  edges: [{ type: 'call', from: { file: '0.js' }, to: { file: '1.js' } }, { type: 'import', from: { file: '200.js' }, to: { file: '201.js' } }] };
const pageOne = projectOutput(map), one = createPageIdentityLookup(pageOne);
const pageTwo = projectOutput(map, { page: 1 }), two = createPageIdentityLookup(pageTwo);
assert.equal(one.has('file:200.js'), false); assert.equal(two.has('file:0.js'), false);
assert.equal(two.get('file:200.js').label, 'Original 200');
const filtered = projectOutput(map, { relation: 'import' }), current = createPageIdentityLookup(filtered);
assert.equal(current.get('file:0.js'), filtered.nodes[0]); assert.equal(filtered.edges.length, 0);
const replaced = projectOutput({ ...map, nodes: [{ path: '0.js', name: 'Replacement', members: [] }] });
assert.equal(createPageIdentityLookup(replaced).get('file:0.js').label, 'Replacement');
assert.equal(one.get('file:0.js').label, 'Original 0', 'an old page does not mutate or grant current-page ownership');

// Preserve incoming/outgoing/self direction, parallel order and missing labels.
const rows = [{ from: 'same', to: '0', kind: 'out' }, { from: 0, to: 'same', kind: 'in' },
  { from: 'same', to: 'same', kind: 'self' }, { from: 'same', to: '0', kind: 'parallel' }, { from: 'same', to: 'missing', kind: 'missing' }];
const baseline = rows.map(edge => `${edge.from === 'same' ? '→' : '←'} ${edge.kind} · ${nodes.find(node => node.id === (edge.from === 'same' ? edge.to : edge.from))?.label ?? 'unloaded'}`);
assert.deepEqual(rows.map(edge => `${edge.from === 'same' ? '→' : '←'} ${edge.kind} · ${lookup.get(edge.from === 'same' ? edge.to : edge.from)?.label ?? 'unloaded'}`), baseline);
console.log('Page-scoped first-match identity lookup preserves selection semantics and removes repeated admitted-node scans.');

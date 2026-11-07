import assert from 'node:assert/strict';
import { selectionEndpointMatcher } from '../../src/map/isometric/client/selection-endpoints.js';

const fileByMember = new Map([[0, 'a.js'], ['0', 'a.js'], ['B', 'b.js']]);
const endpoints = [{ file: 'a.js' }, { member: 0 }, { member: '0' }, { file: 'b.js', member: 'B' }];
const file = selectionEndpointMatcher({ type: 'file', file: 'a.js', id: 'a.js' }, { fileByMember });
assert.deepEqual(endpoints.map(file), [true, true, true, false]);
const zero = selectionEndpointMatcher({ type: 'member', file: 'a.js', id: 0 }, { fileByMember });
assert.deepEqual(endpoints.map(zero), [false, true, true, false]);
const edges = [
  { from: { member: 0 }, to: { file: 'b.js', member: 'B' } },
  { from: { file: 'b.js' }, to: { file: 'a.js' } },
  { from: { member: 0 }, to: { member: 0 } }
];
assert.equal(edges.filter(edge => file(edge.from)).length, 2);
assert.equal(edges.filter(edge => file(edge.to)).length, 2);
assert.equal(edges.filter(edge => zero(edge.from)).length, 2);
assert.equal(edges.filter(edge => zero(edge.to)).length, 1);
assert.equal(selectionEndpointMatcher({ type: 'file', file: 'disconnected.js', id: 'disconnected.js' }, { fileByMember })(endpoints[0]), false);
console.log('Explicit file/member selection uses shared endpoint ownership, including zero, incoming/outgoing and self relations.');

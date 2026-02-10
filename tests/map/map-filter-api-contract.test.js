#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../helpers/test-env.js';
import * as filters from '../../src/map/build-map/filters.js';

applyTestEnv();

assert.equal(typeof filters.createScopeFilters, 'function');
assert.equal(typeof filters.createCollapseTransform, 'function');
assert.equal(typeof filters.applyScopeFilter, 'undefined');
assert.equal(typeof filters.applyCollapse, 'undefined');

const nodes = [
  {
    path: 'src/a.js',
    members: [{ id: 'a#one' }, { id: 'a#two' }]
  },
  {
    path: 'src/b.js',
    members: [{ id: 'b#one' }]
  }
];
const edges = [
  {
    from: { file: 'src/a.js', member: 'a#one' },
    to: { file: 'src/b.js', member: 'b#one' },
    type: 'call'
  }
];

const scopeFilters = filters.createScopeFilters({
  scope: 'member',
  focus: 'a#one',
  edgeIteratorFactory: () => edges,
  normalizeMemberId: (value) => (value ? String(value) : null)
});

const keptA = scopeFilters.nodeFilter(nodes[0]);
const keptB = scopeFilters.nodeFilter(nodes[1]);
assert.equal(keptA.members.length, 1);
assert.equal(keptA.members[0].id, 'a#one');
assert.equal(keptB.members.length, 1);
assert.equal(keptB.members[0].id, 'b#one');
assert.equal(scopeFilters.edgeFilter(edges[0]), true);

const collapse = filters.createCollapseTransform({ collapse: 'file', nodes });
assert.equal(collapse.nodes[0].members.length, 0);
const collapsedEdge = collapse.edgeTransform(edges[0]);
assert.deepEqual(collapsedEdge.from, { file: 'src/a.js' });
assert.deepEqual(collapsedEdge.to, { file: 'src/b.js' });

console.log('map filter api contract test passed');

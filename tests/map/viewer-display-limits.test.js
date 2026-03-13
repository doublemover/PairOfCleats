#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyDisplayLimits } from '../../src/map/isometric/client/display-limits.js';

const map = {
  nodes: [
    {
      path: 'src/a.js',
      name: 'a.js',
      members: [{ id: 'a1' }, { id: 'a2' }]
    },
    {
      path: 'src/b.js',
      name: 'b.js',
      members: [{ id: 'b1' }]
    }
  ],
  edges: [
    { type: 'call', from: { file: 'src/a.js', member: 'a1' }, to: { file: 'src/b.js', member: 'b1' } },
    { type: 'call', from: { file: 'src/a.js', member: 'a2' }, to: { file: 'src/b.js', member: 'b1' } }
  ]
};

const { map: limited, limits } = applyDisplayLimits(map, { maxFiles: 2, maxMembersPerFile: 1, maxEdges: 1 });

assert.equal(limits.maxFiles, 2);
assert.equal(limited.nodes.length, 2);
assert.equal(limited.nodes[0].members.length, 1);
assert.equal(limited.edges.length, 1);
assert.ok(limited.summary.truncated, 'expected truncated summary');

console.log('map viewer display limits test passed');

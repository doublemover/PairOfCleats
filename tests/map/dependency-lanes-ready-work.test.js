#!/usr/bin/env node
import assert from 'node:assert/strict';
import { layoutDependencyLanes } from '../../src/map/isometric/client/layout-utils.js';
const keys = Array.from({ length: 1800 }, (_, index) => String(index).padStart(5, '0'));
const adjacency = new Map(keys.map(key => [key, new Map()]));
for (const key of keys.slice(1)) adjacency.get(keys[0]).set(key, 1);
const items = keys.map(key => ({ key, width: 1, depth: 1 }));
let sorts = 0; const sort = Array.prototype.sort;
try {
  Array.prototype.sort = function (...args) { sorts += 1; return sort.apply(this, args); };
  assert.equal(layoutDependencyLanes(items, 1, adjacency, item => item.key).lanes, 2);
} finally { Array.prototype.sort = sort; }
assert.ok(sorts < 10, `ready admission does not sort per SCC: ${sorts}`);
assert.ok(items.slice(1).every(item => item.x > items[0].x));
const reversed = [...keys].reverse().map(key => ({ key, width: 1, depth: 1 }));
layoutDependencyLanes(reversed, 1, adjacency, item => item.key);
assert.deepEqual(reversed.sort((a, b) => a.key.localeCompare(b.key)), items);
const cycle = new Map([['a', new Map([['b', 1]])], ['b', new Map([['a', 1]])]]);
assert.equal(layoutDependencyLanes(['a', 'b'].map(key => ({ key, width: 1, depth: 1 })), 1, cycle, item => item.key).lanes, 1);

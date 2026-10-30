import assert from 'node:assert/strict';
import { layoutDependencyLanes } from '../../src/map/isometric/client/layout-utils.js';
const items = Array.from({ length: 12000 }, (_, i) => ({ id: `n${i}` }));
const adjacency = new Map(items.map((item, i) => [item.id, new Set(i + 1 < items.length ? [`n${i+1}`] : [])]));
const result = layoutDependencyLanes(items, 1, adjacency, item => item.id);
assert.ok(result);
adjacency.get('n11999').add('n0');
assert.ok(layoutDependencyLanes(items, 1, adjacency, item => item.id));
console.log('deep dependency layout passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createPropertyPathOverlapIndex } from '../../../src/index/semantic/compiler-property-path-index.js';
import { propertyPathsOverlap } from '../../../src/index/semantic/compiler-property-paths.js';
const brands = [{ private: '#x', source: 'a.js', owner: 1 }, { private: '#x', source: 'b.js', owner: 1 }];
const segments = ['a', 'b', '*', null, ...brands];
const paths = [[], ...segments.map(value => [value]), ...segments.flatMap(first => segments.map(second => [first, second]))];
const rows = [...paths, ['a'], []].map((path, ordinal) => ({ path, ordinal }));
const index = createPropertyPathOverlapIndex(rows);
for (const path of paths) assert.deepEqual(index.query(path).matches.map(row => row.ordinal),
  rows.filter(row => propertyPathsOverlap(path, row.path)).map(row => row.ordinal));
let work = 0;
const sparse = Array.from({ length: 1000 }, (_, ordinal) => ({ path: ['field' + ordinal], ordinal }));
const sparseIndex = createPropertyPathOverlapIndex(sparse, { spend: () => { work++; return true; } });
for (const row of sparse) assert.deepEqual(sparseIndex.query(row.path).matches, [row]);
assert.ok(work < 10000, 'disjoint field siblings avoid all-pairs comparisons');
let budget = 5;
const bounded = createPropertyPathOverlapIndex(rows, { spend: () => --budget >= 0 });
assert.equal(bounded.complete, false); assert.equal(bounded.query([]).truncated, true);

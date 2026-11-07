import assert from 'node:assert/strict';
import { normalizeIncrementalRelPath, resolvePrefetchedVfsRows } from '../../../src/index/build/incremental/paths.js';
const upper = normalizeIncrementalRelPath('src/Foo.js'), lower = normalizeIncrementalRelPath('src/foo.js');
assert.notEqual(upper, lower);
const rows = new Map([[upper, ['upper']], [lower, ['lower']]]);
assert.deepEqual(resolvePrefetchedVfsRows(rows, upper, upper).rows, ['upper']);
assert.deepEqual(resolvePrefetchedVfsRows(rows, lower, lower).rows, ['lower']);
console.log('case-distinct incremental source identities passed');

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getStructuralMatchesForChunk, prepareStructuralMatches } from '../../../src/index/build/file-processor/chunk.js';
const matches = [{ startLine: 30, endLine: 40 }, { startLine: 1, endLine: 100 }, { startLine: 9, endLine: 10 }, {}, { startLine: NaN, endLine: 0 }, { startLine: 3, endLine: 2 }, { startLine: 10, endLine: 10 }];
for (const total of [100, undefined, 0]) {
  const prepared = prepareStructuralMatches(matches, total);
  for (const [start, end] of [[10, 10], [90, 99], [1, 2], [40, 30], [undefined, undefined], [10, 30], [3, 3]]) {
    assert.deepEqual(getStructuralMatchesForChunk(prepared, start, end, total), getStructuralMatchesForChunk(matches, start, end, total));
  }
}
const sparse = Array.from({ length: 1000 }, (_, index) => ({ startLine: index * 3 + 1, endLine: index * 3 + 1 }));
const index = prepareStructuralMatches(sparse, 3000);
for (let row = 999; row >= 0; row -= 37) assert.deepEqual(getStructuralMatchesForChunk(index, row * 3 + 1, row * 3 + 1, 3000), [sparse[row]]);

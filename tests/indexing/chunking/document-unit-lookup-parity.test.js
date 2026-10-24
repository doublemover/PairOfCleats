#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createDocumentUnitRangeLookup, findCoveredUnitRange } from '../../../src/index/chunking/formats/document-common.js';
let reads = 0;
const units = Array.from({ length: 2000 }, (_, index) => ({ index: index * 2 + 1,
  get start() { reads++; return index * 10; }, get end() { reads++; return index * 10 + 8; } }));
const lookup = createDocumentUnitRangeLookup(units);
for (let index = 0; index < units.length; index++) assert.deepEqual(lookup({ startOffset: index * 10, endOffset: index * 10 + 8,
  startField: 'index', endField: 'index' }), { start: index * 2 + 1, end: index * 2 + 1 });
assert.ok(reads <= units.length * 4, 'coordinate traversal is linear for ordered chunks');
for (const candidate of [units, [...units].reverse(), [{ start: NaN, end: 2, index: 1 }, ...units.slice(0, 5)]]) {
  const prepared = createDocumentUnitRangeLookup(candidate);
  for (const [startOffset, endOffset] of [[40, 55], [0, 8], [19, 20], [10, 10], [5, 6], [100, 150], [0, 20000]]) {
    const input = { startOffset, endOffset, startField: 'index', endField: 'index', fallbackStart: 77, fallbackEnd: 99 };
    assert.deepEqual(prepared(input), findCoveredUnitRange({ units: candidate, ...input }));
  }
}

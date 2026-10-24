import assert from 'node:assert/strict';
import { createArchiveSpanIndex } from '../../../src/integrations/inference-history/archive-unit-spans.js';
let reads = 0;
const spans = Array.from({ length: 2000 }, (_, id) => ({ get start() { reads++; return id * 100; },
  end: (id + 1) * 100, text: `${id}`, title: '' }));
const overlaps = createArchiveSpanIndex(spans);
const coldReads = reads;
for (let id = 1999; id >= 0; id--) assert.equal(overlaps(id * 100, (id + 1) * 100)[0], spans[id]);
assert.equal(reads, coldReads, 'queries reuse captured interval bounds rather than reread all span starts');
const mixed = [{ start: 20, end: 40, text: 'first' }, { start: 0, end: 100, text: 'outer' },
  { start: 20, end: 40, text: 'duplicate' }, { start: 50, end: 70, text: 'later' }];
const query = createArchiveSpanIndex(mixed);
for (const [start, end] of [[0, 1], [20, 30], [40, 50], [60, 90], [100, 120]]) {
  assert.deepEqual(query(start, end), mixed.filter(span => span.start < end && span.end > start));
}
console.log('Archive interval lookup preserves overlap and source order without per-fragment full scans.');

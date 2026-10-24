#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createCfgRoutingLookup } from '../../../src/index/semantic/compiler-cfg-routing.js';
const reference = (starts, select, barrier) => {
  const pending = [...starts], seen = new Set(), result = [];
  while (pending.length) { const current = pending.pop(); if (seen.has(current)) continue; seen.add(current);
    if (select(current)) result.push(current); if (!barrier(current)) for (const next of current.next) pending.push(next); }
  return result;
};
for (const cyclic of [false, true]) {
  const blocks = Array.from({ length: 12 }, (_, id) => ({ id, next: [], read: id % 3 === 0, stop: id === 7 }));
  for (let id = 0; id < 11; id++) blocks[id].next.push(blocks[id + 1]);
  blocks[0].next.push(blocks[4]); blocks[2].next.push(blocks[8]); if (cyclic) blocks[8].next.push(blocks[2]);
  for (const barrier of [() => false, block => block.stop]) {
    const select = block => block.read;
    const lookup = createCfgRoutingLookup({ successors: block => block.next, select, barrier });
    for (let id = 0; id < 10; id++) for (const starts of [[blocks[id]], [blocks[id], blocks[4]]]) {
      assert.deepEqual(lookup.query(starts), reference(starts, select, barrier));
    }
  }
}
let visits = 0;
const chain = Array.from({ length: 1000 }, (_, id) => ({ id, next: [] }));
for (let id = 0; id < 999; id++) chain[id].next.push(chain[id + 1]);
const lookup = createCfgRoutingLookup({ successors: block => block.next, select: block => block.id === 999,
  spend: () => { visits++; return true; } });
for (const block of chain) assert.deepEqual(lookup.query([block]), [chain[999]]);
assert.ok(visits < 5000, 'sparse suffixes avoid full traversal per query');
assert.ok(lookup.stats().memberships < 10, 'unchanged suffix arrays are shared');
const bounded = createCfgRoutingLookup({ successors: block => block.next, select: () => true, maxCacheMemberships: 2 });
assert.deepEqual(bounded.query([chain[0]]), chain, 'dense cache exhaustion preserves the reference traversal');
const controller = new AbortController(); controller.abort();
assert.throws(() => createCfgRoutingLookup({ successors: block => block.next, select: () => false,
  signal: controller.signal }).query([chain[0]]), { code: 'ABORT_ERR' });

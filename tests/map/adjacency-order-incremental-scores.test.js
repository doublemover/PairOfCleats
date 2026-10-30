import assert from 'node:assert/strict';
import { orderByAdjacency } from '../../src/map/isometric/client/layout-utils.js';

// The pre-repair scoring rule, without the unrelated >300 lexical fallback.
const reference = (items, adjacency) => {
  const totals = new Map(items.map(key => [key, [...(adjacency.get(key)?.values() || [])].reduce((sum, value) => sum + value, 0)]));
  const remaining = new Set(items), placed = [];
  const first = items.slice().sort((a, b) => (totals.get(b) - totals.get(a)) || a.localeCompare(b))[0];
  if (first == null) return [];
  placed.push(first); remaining.delete(first);
  while (remaining.size) {
    let best = null, bestScore = -Infinity;
    for (const candidate of remaining) {
      let score = 0;
      for (const key of placed) score += adjacency.get(candidate)?.get(key) || 0;
      score += (totals.get(candidate) || 0) * 0.1;
      if (score > bestScore || score === bestScore && best != null && candidate.localeCompare(best) < 0) {
        best = candidate; bestScore = score;
      }
    }
    placed.push(best); remaining.delete(best);
  }
  return placed;
};
let seed = 3289;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
for (const count of [0, 1, 2, 17, 60, 150, 300, 301, 420]) {
  const keys = Array.from({ length: count }, (_, index) => `key:${String(index).padStart(4, '0')}`);
  for (const shape of ['empty', 'chain', 'directed', 'weighted', 'cycle']) {
    const adjacency = new Map(keys.map(key => [key, new Map()]));
    for (let i = 0; i < count; i++) {
      if (shape === 'chain' && i) adjacency.get(keys[i]).set(keys[i - 1], 1);
      if (shape === 'cycle') adjacency.get(keys[i]).set(keys[(i + 1) % count], 1);
      if (shape === 'directed' || shape === 'weighted') {
        for (let j = 0; j < count; j++) if (random() < 0.025) {
          adjacency.get(keys[i]).set(keys[j], shape === 'weighted' ? Math.floor(random() * 9) / 7 : 1);
        }
        // Out-of-domain neighbor weights still contribute the same total bonus.
        adjacency.get(keys[i]).set('external', i % 3);
      }
    }
    const shuffled = keys.map(key => ({ key, rank: random() })).sort((a, b) => a.rank - b.rank).map(row => row.key);
    const expected = reference(shuffled, adjacency);
    let neighborGets = 0, edgeVisits = 0;
    class CountedNeighbors extends Map {
      get(key) { neighborGets += 1; return super.get(key); }
      *[Symbol.iterator]() { for (const row of super[Symbol.iterator]()) { edgeVisits += 1; yield row; } }
    }
    const counted = new Map([...adjacency].map(([key, neighbors]) => [key, new CountedNeighbors(neighbors)]));
    assert.deepEqual(orderByAdjacency(shuffled, key => key, counted), expected, `${shape}/${count}`);
    assert.equal(neighborGets, 0, 'candidate scores never rescan placed-neighbor lookups');
    assert.ok(edgeVisits <= [...adjacency.values()].reduce((sum, neighbors) => sum + neighbors.size, 0));
  }
}
console.log('Incremental directed adjacency scores preserve ordering with one edge traversal and quadratic selection.');

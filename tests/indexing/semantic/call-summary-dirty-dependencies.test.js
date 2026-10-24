#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCallDependencySummaries } from '../../../src/index/semantic/compiler-call-summaries.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
const ref = localId => ({ partitionId: 'sy1:' + 'a'.repeat(64), localId });
const channel = (from, to) => ({ kind: 'flowsTo', from: ref(from), to: ref(to) });
const make = (count, ring = false) => {
  const summaries = [], calls = [], flowEdges = [];
  for (let index = 0; index < count; index++) {
    const base = index * 10;
    summaries.push({ declaration: ref(base), parameters: [ref(base + 1)], returns: [ref(base + 2)],
      exceptions: [], effects: [], span: [index * 100, index * 100 + 90], complete: true });
    if (index < count - 1 || ring) {
      calls.push({ occurrence: ref(base + 4), result: ref(base + 3), targets: [ref(((index + 1) % count) * 10)],
        arguments: [ref(base + 1)], span: [index * 100 + 10, index * 100 + 20], invocationKind: 'call', hasSpread: false });
      flowEdges.push(channel(base + 3, base + 2));
    }
    if (index === count - 1) flowEdges.push(channel(base + 1, base + 2));
  }
  return [{ summaries, calls, flowEdges }];
};
for (const [count, ring] of [[40, false], [8, true]]) {
  const result = buildCallDependencySummaries(make(count, ring), { maxIterations: 50 });
  assert.equal(result.converged, true);
  for (let index = 0; index < count; index++) assert.deepEqual([...result.functions.get(canonicalSemanticJson(ref(index * 10))).dependencies], [0]);
  assert.ok(result.stats.reachabilityCacheHits > 0);
  assert.ok(result.stats.cachedMemberships <= 65536);
  if (!ring) assert.ok(result.stats.callInstantiations <= count, 'unchanged callee revisions skip repeat call instantiation');
}
const unknown = make(3, true); unknown[0].calls.push({ occurrence: ref(100), result: ref(101), targets: [ref(999)],
  arguments: [], span: [30, 40], invocationKind: 'call', hasSpread: false });
const partial = buildCallDependencySummaries(unknown, { maxIterations: 50 });
assert.equal(partial.converged, true);
assert.ok([...partial.functions.values()].every(summary => summary.complete === false), 'terminal completeness changes propagate without new value bits');
assert.equal(buildCallDependencySummaries(make(8, true), { maxIterations: 0 }).converged, false);
assert.equal(buildCallDependencySummaries(make(8, true), { maxIterations: 1 }).converged, false);
const controller = new AbortController(); controller.abort();
assert.throws(() => buildCallDependencySummaries(make(2), { signal: controller.signal }), { code: 'ABORT_ERR' });

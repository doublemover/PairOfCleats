import assert from 'node:assert/strict';
import { runRenderSortBench } from '../../../tools/bench/graph/render-sort.js';
import { renderGraphContextPack } from '../../../src/retrieval/output/graph-context-pack.js';
import { compareGraphNodes, compareGraphEdges, compareWitnessPaths } from '../../../src/graph/ordering.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
for (const size of [1, 32, 257]) {
  const observed = [];
  const result = await runRenderSortBench({ size, iterations: 2, mode: 'compare' }, { render: pack => {
    observed.push(pack); return renderGraphContextPack(pack);
  } });
  assert.equal(result.comparison, 'redundant-sort-removal-on-the-same-canonical-pack');
  assert.equal(result.parity.state, 'byte-identical'); assert.match(result.parity.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(result.preparation.includedInRenderTiming, false); assert.equal(result.workload.nodes, size);
  assert.equal(result.workload.paths, size - 1);
  assert.equal(observed.length, 9, 'three parity checks, one warmup per arm and two measured renders per arm');
  const baseline = observed[0], current = observed[1];
  assert.equal(baseline.nodes, current.nodes); assert.equal(baseline.edges, current.edges); assert.equal(baseline.paths, current.paths);
  for (const [key, compare] of [['nodes', compareGraphNodes], ['edges', compareGraphEdges], ['paths', compareWitnessPaths]]) {
    assert.deepEqual(current[key], current[key].toSorted(compare));
  }
  assert.equal(baseline.stats.sorted, false); assert.equal(current.stats.sorted, true);
  for (const arm of ['baseline', 'current']) {
    assert.equal(result[arm].completedOperations, 2); assert.equal(result[arm].rawSampleDurationsMs.length, 2);
  }
}
let calls = 0;
await assert.rejects(runRenderSortBench({ size: 32, iterations: 2, mode: 'compare' }, { render: pack => {
  calls++; return renderGraphContextPack(pack) + (pack.stats.sorted ? 'incorrect-current-arm' : '');
} }), { code: 'ERR_BENCH_GRAPH_RENDER_PARITY' });
assert.equal(calls, 2, 'parity rejection precedes all warmup and timed rendering');
await assert.rejects(runRenderSortBench({ size: 2, iterations: 1.5, mode: 'compare' }), RangeError);
console.log('Render-sort comparison admits identical canonical nodes, edges and paths before any measured operation.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildGraphIndex } from '../../src/graph/store.js';
import { buildGraphNodeIndex } from '../../src/graph/indexes.js';
import { admitCsrFamily } from '../../src/graph/csr-order.js';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { createDirectedGraphNeighborResolver, createGraphNeighborResolver } from '../../src/graph/neighborhood/walker.js';
import { createWorkBudget } from '../../src/graph/work-budget.js';
import { requireBootstrap } from '../../src/shared/bootstrap-readiness.js';
await requireBootstrap();
assert.equal(typeof global.gc, 'function', 'run the explicit qualification with --expose-gc');
const files = ['src/graph/store.js', 'src/graph/indexes.js', 'src/graph/csr-order.js',
  'src/graph/neighborhood.js', 'src/graph/neighborhood/walker.js', 'src/graph/neighborhood/csr.js'];
const identities = () => files.map(file => ({ file,
  sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
const source = identities(), samples = [], results = [];
const measure = (phase, dimensions, action) => {
  const before = process.memoryUsage(), cpu = process.cpuUsage(), start = performance.now();
  const value = action();
  const elapsedMs = performance.now() - start, cpuUsed = process.cpuUsage(cpu), after = process.memoryUsage();
  samples.push({ phase, ...dimensions, elapsedMs, cpuUserMicros: cpuUsed.user, cpuSystemMicros: cpuUsed.system,
    memory: { heapBefore: before.heapUsed, heapAfter: after.heapUsed, rssBefore: before.rss, rssAfter: after.rss } });
  return value;
};
const canonical = result => JSON.stringify({ nodes: result.nodes, edges: result.edges,
  paths: result.paths, truncation: result.truncation, warnings: result.warnings,
  counts: result.stats.counts, capsTriggered: result.stats.capsTriggered });
const typedBytes = index => Object.values(index.graphRelationsCsr || {}).reduce((sum, family) =>
  sum + (family?.offsets?.byteLength || 0) + (family?.edges?.byteLength || 0), 0);
const qualifyGeneration = (degree, trial) => {
  const ids = Array.from({ length: degree + 1 }, (_, i) => 'n' + String(i).padStart(6, '0'));
  const nodes = ids.map((id, i) => ({ id, out: i ? [ids[0], ids[0]] : [ids[0], ...ids.slice(1), ids[1]],
    in: i ? [ids[0]] : ids }));
  const graph = { version: 1, callGraph: { nodes }, usageGraph: { nodes: [] }, importGraph: { nodes: [] } };
  const inputIdentity = JSON.stringify(graph);
  const dimensions = { degree, trial };
  global.gc(); const baseHeap = process.memoryUsage().heapUsed;
  const ordinary = measure('ordinary-index-and-count-preparation', dimensions,
    () => buildGraphIndex({ graphRelations: graph }));
  global.gc(); const ordinaryRetainedHeapDelta = process.memoryUsage().heapUsed - baseHeap;
  const beforeCsr = process.memoryUsage().heapUsed;
  const compact = measure('csr-index-and-admission-preparation', dimensions,
    () => buildGraphIndex({ graphRelations: graph, includeCsr: true }));
  global.gc(); const csrRetainedHeapDelta = process.memoryUsage().heapUsed - beforeCsr;
  measure('explicit-full-order-count-admission-scan', dimensions, () =>
    assert.equal(admitCsrFamily(compact.graphRelationsCsr.callGraph, compact.callGraphIds), true));
  const view = createGraphNeighborResolver({ graphIndex: compact, iterableCsr: true });
  assert.equal(compact._csrReverseByGraph, undefined);
  const incomingCount = measure('first-incoming-count-with-reverse-csr', dimensions, () =>
    view.count(compact.callGraphIndex, ids[0], 'in', null, null, 'callGraph'));
  const reverse = compact._csrReverseByGraph.callGraph;
  assert.equal(incomingCount, degree + 1);
  measure('warm-incoming-exact-count', dimensions, () =>
    assert.equal(view.count(compact.callGraphIndex, ids[0], 'in', null, null, 'callGraph'), incomingCount));
  assert.equal(compact._csrReverseByGraph.callGraph, reverse);
  const rawMap = measure('raw-node-index-preparation', dimensions, () => buildGraphNodeIndex(graph.callGraph));
  const unprepared = { ...compact, callGraphIndex: rawMap, graphRelationsCsr: null, callGraphAdjacency: null };
  const fallback = createDirectedGraphNeighborResolver({ graphIndex: unprepared, iterableCsr: true });
  let observed;
  const fallbackPrefix = measure('unprepared-normalize-deduplicate-first-scan', dimensions, () =>
    [...fallback(rawMap, ids[0], 'out', null, null, 'callGraph',
      { limit: 1, onCount: count => { observed = count; } })]);
  assert.equal(fallbackPrefix.length, 1); assert.equal(observed, degree + 1);
  const layout = { ...dimensions, forwardTypedBytes: typedBytes(compact),
    reverseTypedBytes: reverse.offsets.byteLength + reverse.edges.byteLength,
    ordinaryRetainedHeapDelta, csrRetainedHeapDelta,
    ordinaryAdjacencyEncodedBytes: Buffer.byteLength(JSON.stringify([...ordinary.callGraphAdjacency])),
    memoryScope: 'retained process heap boundary after explicit GC; encoded adjacency is wire size, not object heap attribution' };
  for (const direction of ['out', 'in', 'both']) {
    for (const cap of [1, 3]) {
      const request = { seed: { type: 'chunk', chunkUid: ids[0] }, depth: 1, direction,
        includePaths: true, edgeFilters: { graphs: ['callGraph'] }, caps: { maxFanoutPerNode: cap } };
      const oracle = canonical(buildGraphNeighborhood({ ...request, graphIndex: ordinary,
        workBudget: createWorkBudget() }));
      for (let repetition = 0; repetition < 4; repetition++) {
        let evidence = 0;
        compact.callSiteIndex = { get() { evidence++; return null; } };
        const actual = measure('cache-miss-neighborhood', { ...dimensions, direction, cap, repetition }, () =>
          buildGraphNeighborhood({ ...request, graphIndex: compact, workBudget: createWorkBudget() }));
        assert.equal(canonical(actual), oracle);
        assert.equal(evidence, cap);
        const total = direction === 'both' ? degree * 2 + 1 : degree + 1;
        assert.equal(actual.truncation.find(entry => entry.cap === 'maxFanoutPerNode').observed, total);
        results.push({ ...dimensions, direction, cap, repetition, evidenceLookups: evidence,
          observed: total, outputDigest: createHash('sha256').update(oracle).digest('hex') });
      }
    }
  }
  let evidence = 0;
  compact.callSiteIndex = { get() { evidence++; return null; } };
  const tiny = buildGraphNeighborhood({ seed: { type: 'chunk', chunkUid: ids[0] }, depth: 1,
    direction: 'out', graphIndex: compact, caps: { maxWorkUnits: 1 }, workBudget: createWorkBudget({ maxWorkUnits: 1 }) });
  assert.equal(evidence, 0); assert.equal(tiny.edges.length, 0);
  assert.ok(tiny.truncation.some(entry => entry.cap === 'maxWorkUnits'));
  let descriptorAdmissions = 0;
  const directed = createDirectedGraphNeighborResolver({ graphIndex: compact, iterableCsr: true });
  const descriptors = [...directed(compact.callGraphIndex, ids[0], 'out', null, null, 'callGraph',
    { limit: 1, admit: () => { descriptorAdmissions++; return true; } })];
  assert.equal(descriptors.length, 1); assert.equal(descriptorAdmissions, 1);
  results.push({ ...layout, tinyBudgetEvidenceLookups: evidence, descriptorAdmissions, descriptorCount: descriptors.length });
  assert.equal(JSON.stringify(graph), inputIdentity, 'successive direction/cap requests cannot mutate producer input');
};
for (const degree of [8, 256, 20000]) for (let trial = 0; trial < 3; trial++) {
  global.gc();
  qualifyGeneration(degree, trial);
}
assert.deepEqual(identities(), source, 'qualification cannot span changed source');
process.stdout.write(JSON.stringify({ schemaVersion: 1, node: process.version, platform: process.platform, source,
  scope: 'serial supported-runtime synthetic degree/cap qualification; fresh index and reverse setup separated; every neighborhood bypasses traversal cache',
  memoryPolicy: 'GC retained heap boundaries plus exact typed-array byte lengths; no transient peak or application speedup claim',
  samples, results }) + '\n');

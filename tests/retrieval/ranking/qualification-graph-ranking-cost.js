import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { applyGraphRanking } from '../../../src/retrieval/pipeline/graph-ranking.js';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
await requireBootstrap();
const files = ['src/graph/indexes.js', 'src/graph/prepared-node-indexes.js',
  'src/retrieval/pipeline/graph-ranking.js'];
const identities = () => files.map(file => ({ file,
  sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
const sourceBefore = identities(), samples = [];
const canonical = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const warmRepetitions = 5, trials = 6;
const workloads = [{ degree: 16, indexedLeaves: 16, candidates: 3 },
  { degree: 4096, indexedLeaves: 512, candidates: 16 },
  { degree: 65536, indexedLeaves: 2048, candidates: 128 }];
for (const { degree, indexedLeaves, candidates } of workloads) {
  const entries = ['seed', ...Array.from({ length: candidates - 1 }, (_, i) =>
    'leaf-' + String(i).padStart(6, '0'))].map((chunkUid, idx) => ({ idx,
    score: 1 - idx / (candidates + 1), chunk: { chunkUid } }));
  const makeGraph = () => {
    const neighbors = Array.from({ length: degree }, (_, i) => 'leaf-' + String(degree - 1 - i).padStart(6, '0'));
    const leaves = Array.from({ length: indexedLeaves }, (_, i) => ({ id: 'leaf-' + String(i).padStart(6, '0'), out: [], in: [] }));
    return { callGraph: { nodes: [{ id: 'seed', out: neighbors, in: [] }, ...leaves] },
      usageGraph: { nodes: [] } };
  };
  for (const kind of ['degree-only', 'bounded-proximity']) {
    for (let trial = 0; trial < trials; trial++) {
      const graphRelations = makeGraph(); let expected;
      const config = { enabled: true, weights: { degree: kind === 'degree-only' ? 1 : 0,
        proximity: kind === 'bounded-proximity' ? 1 : 0 }, seedSelection: 'top1', maxGraphWorkUnits: 1,
      expansion: { maxDepth: 1, maxWidthPerNode: 1, maxVisitedNodes: 8 } };
      for (let repetition = 0; repetition <= warmRepetitions; repetition++) {
        const before = process.memoryUsage(), start = performance.now();
        const result = applyGraphRanking({ entries, graphRelations, config });
        const elapsedMs = performance.now() - start, after = process.memoryUsage();
        const digest = canonical(result.entries);
        if (repetition === 0) expected = digest;
        else { assert.equal(digest, expected); assert.equal(result.stats.preparation.nodeSlotsVisited, 0);
          assert.equal(result.stats.preparation.adjacencyInputsVisited, 0); }
        if (kind === 'degree-only') assert.equal(result.stats.preparation.adjacencyInputsVisited, 0);
        else if (!repetition) assert.equal(result.stats.preparation.adjacencyInputsVisited, degree);
        samples.push({ workload: { degree, indexedLeaves, candidates }, kind, trial, repetition, cache: repetition ? 'same-generation-warm' : 'generation-cold',
          elapsedMs, resultDigest: digest, setup: result.stats.preparation,
          traversal: { workUnitsUsed: result.stats.workUnitsUsed, stopReason: result.stats.stopReason,
            visitedNodes: result.stats.visitedNodes },
          memoryBoundaries: { heapUsedBefore: before.heapUsed, heapUsedAfter: after.heapUsed,
            rssBefore: before.rss, rssAfter: after.rss } });
      }
    }
  }
}
assert.deepEqual(identities(), sourceBefore, 'qualification cannot span changed source bytes');
process.stdout.write(JSON.stringify({ schemaVersion: 1, node: process.version, platform: process.platform,
  source: sourceBefore, workloads, trials, warmRepetitions,
  scope: 'generation-cold versus same-process/same-generation warm; module import/process startup excluded',
  memoryPolicy: 'before/after observations; no transient/process peak claim',
  acceptance: 'operation counts and byte-identical scored output; no latency threshold or application speedup claim', samples }) + '\n');

import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { CACHE_MEASUREMENT_SHAPE, cacheMeasurementCorpus, summarizeCacheSamples } from '../../fixtures/benchmarks/tree-sitter-cache-workload.js';
import { CHUNK_CACHE_LIMITS } from '../../../src/lang/tree-sitter/chunking/cache-schema.js';
const corpus = cacheMeasurementCorpus(); assert.equal(corpus.length, 32);
assert.equal(new Set(corpus.map(row => row.sourceHash)).size, 32);
for (const source of corpus) {
  new Script(source.text); // Real language parsing, no synthetic AST or native claim.
  assert.equal([...source.text.matchAll(/^function measured\d{4}\(/gm)].length, 512);
}
assert.deepEqual(CACHE_MEASUREMENT_SHAPE.workerCounts, [1, 2]);
assert.deepEqual(CACHE_MEASUREMENT_SHAPE.queryModes, [false, true]); assert.equal(CACHE_MEASUREMENT_SHAPE.repetitions, 3);
assert.equal(CHUNK_CACHE_LIMITS.maxEntryBytes, 8 * 1024 * 1024); assert.equal(CHUNK_CACHE_LIMITS.maxRetainedBytes, 32 * 1024 * 1024);
assert.deepEqual(summarizeCacheSamples(Array.from({ length: 32 }, (_, index) => 32 - index)),
  { count: 32, minMs: 1, medianMs: 16.5, p95Ms: 31, maxMs: 32, totalMs: 528 });
for (const bad of [[], [1], Array(32).fill(-1), Array(32).fill(NaN)]) assert.throws(() => summarizeCacheSamples(bad), TypeError);
console.log('Fixed cache-measurement corpus/cohorts and independent percentile boundaries;actual native/resource qualification remains explicit.');

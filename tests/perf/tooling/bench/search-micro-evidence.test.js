#!/usr/bin/env node
import assert from 'node:assert/strict';
import { samplePayload } from '../../../fixtures/search-micro/receipt.js';
import { observeSearchMicroSample, createSearchMicroCollector, captureMicroQuerySchedule } from '../../../../tools/bench/micro/search-observation.js';
import { withMicrobenchCacheOwner } from '../../../../tools/bench/micro/cache-owner.js';

const options = { mode: 'code', scoreMode: 'sparse', workMode: 'retrieval', requestedBackend: 'memory' };
const retrieval = observeSearchMicroSample(samplePayload(), options);
assert.equal(retrieval.status, 'observed'); assert.equal(retrieval.cache.hit, false);
assert.equal(retrieval.operations.candidateStages, 1);
assert.equal(retrieval.operations.vectorResultStages, 0);
assert.equal(retrieval.operations.queryEmbeddingComputations, null);
assert.equal(retrieval.operations.queryEmbeddingRequests, 0);
assert.equal(retrieval.model.status, 'not-applicable');
const cached = observeSearchMicroSample(samplePayload({ hit: true, enabled: true }), { ...options, workMode: 'result-cache' });
assert.equal(cached.status, 'observed'); assert.equal(cached.operations.candidateStages, 0);
assert.equal(cached.outputIdentity, retrieval.outputIdentity, 'cache work policy must preserve returned source/rank identity');
assert.equal(cached.policyIdentity, retrieval.policyIdentity);
assert.ok(observeSearchMicroSample(samplePayload({ hit: true, enabled: true }), options).missing.includes('result-cache-not-bypassed'));
assert.ok(observeSearchMicroSample(samplePayload({ enabled: true }), { ...options, workMode: 'result-cache' }).missing.includes('result-cache-hit-not-observed'));
const absent = samplePayload(); delete absent.stats.pipeline; delete absent.retrieval.cache.hit;
const unknown = observeSearchMicroSample(absent, options);
assert.equal(unknown.status, 'unqualified'); assert.equal(unknown.cache.hit, null);
assert.equal(unknown.operations.candidateStages, null);
for (const alter of [payload => { delete payload.stats.work; },
  payload => { payload.stats.work.embeddingRequests = null; },
  payload => { payload.stats.work.embeddingApiCalls = 1; }]) {
  const malformed = samplePayload(); alter(malformed);
  const observed = observeSearchMicroSample(malformed, options);
  assert.equal(observed.status, 'unqualified');
  assert.equal(observed.operations.queryEmbeddingRequests, null);
}
const fallback = samplePayload(); fallback.retrieval.fidelity.byMode.code.status = 'partial';
fallback.retrieval.fidelity.byMode.code.cacheable = false;
fallback.retrieval.fidelity.byMode.code.reasons = ['sparse-provider-failure'];
assert.equal(observeSearchMicroSample(fallback, options).status, 'unqualified');
const ann = observeSearchMicroSample(samplePayload({ backend: 'sqlite', ann: true, source: 'sqlite-vector' }),
  { ...options, scoreMode: 'dense', requestedBackend: 'sqlite', annBackend: 'sqlite-vector' });
assert.equal(ann.status, 'observed'); assert.equal(ann.backend.vectorProviders['sqlite-vector'], 1);
assert.equal(ann.operations.queryEmbeddingRequests, 1); assert.equal(ann.operations.queryEmbeddingApiCalls, 1);
assert.equal(ann.model.status, 'unqualified', 'configured model/provider names cannot invent runtime artifact qualification');
const unavailable = samplePayload({ ann: false });
assert.ok(observeSearchMicroSample(unavailable, { ...options, scoreMode: 'dense' }).missing.includes('vector-provider-work-not-observed'));
const unrecognized = samplePayload({ ann: true, source: 'not-an-actual-provider' });
assert.equal(observeSearchMicroSample(unrecognized, { ...options, scoreMode: 'dense' }).status, 'unqualified');
const collector = createSearchMicroCollector(options);
for (let index = 0; index < 100; index++) collector.observe(samplePayload(), { phase: 'measured', queryIndex: 0, durationMs: index + 1 });
const measured = collector.snapshot().phases.measured;
assert.equal(measured.samples, 100); assert.equal(measured.qualified, 100); assert.equal(measured.cacheMisses, 100);
assert.equal(measured.candidateStages, 100); assert.equal(measured.retainedSamples.length, 64);
assert.equal(measured.omittedSampleReceipts, 36); assert.equal(measured.controls.length, 1); assert.equal(measured.controlDrift, 0);
const drift = samplePayload(); drift.code[0].chunkUid += 'changed';
collector.observe(drift, { phase: 'measured', queryIndex: 0, durationMs: 1 });
assert.equal(collector.snapshot().phases.measured.controlDrift, 1);
const schedule = captureMicroQuerySchedule('one', ['one', 'two', 'one']);
assert.equal(schedule.count, 3); assert.equal(Object.isFrozen(schedule.queries), true);
assert.notEqual(schedule.identity, captureMicroQuerySchedule('one', ['one', 'one', 'two']).identity);
assert.throws(() => captureMicroQuerySchedule('', []));
assert.throws(() => captureMicroQuerySchedule('', ['valid', null]));
assert.throws(() => captureMicroQuerySchedule('', ['x'.repeat(65537)]));
assert.throws(() => captureMicroQuerySchedule('', ['\ud800']));
assert.throws(() => captureMicroQuerySchedule('', Array(65).fill('x'.repeat(65536))));
let disposed = 0;
assert.equal(await withMicrobenchCacheOwner({ dispose() { disposed++; } }, async () => 7), 7);
assert.equal(disposed, 1);
const primary = Object.freeze(new Error('primary workload failure')), cleanup = Object.freeze(new Error('cleanup failure'));
const contains = (value, expected) => {
  const pending = [value], seen = new Set();
  while (pending.length) {
    const item = pending.pop(); if (item === expected) return true;
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item); pending.push(item.cause, ...(Array.isArray(item.errors) ? item.errors : []));
  }
  return false;
};
await assert.rejects(withMicrobenchCacheOwner({ dispose() { throw cleanup; } }, async () => { throw primary; }),
  error => contains(error, primary) && contains(error, cleanup));
await assert.rejects(withMicrobenchCacheOwner({ dispose() { throw cleanup; } }, async () => 7), error => error === cleanup);
console.log('Search microbenchmark receipts distinguish cache work, actual stage observations, unknowns and owned cleanup.');

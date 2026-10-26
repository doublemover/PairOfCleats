#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { samplePayload } from '../../../fixtures/search-micro/receipt.js';
import { captureMicroQuerySchedule, createSearchMicroCollector } from '../../../../tools/bench/micro/search-observation.js';
import { compareSearchMicroBaseline } from '../../../../tools/bench/micro/baseline.js';
import { SEARCH_MICRO_REPORT_VERSION } from '../../../../src/contracts/search-microbenchmark.js';
import { EMBEDDING_IDENTITY_VERSION } from '../../../../src/shared/embedding-identity.js';

const makeReport = ({ backend = 'memory', workMode = 'retrieval', query = 'original query', mean = 100 } = {}) => {
  const collector = createSearchMicroCollector({ mode: 'code', scoreMode: 'sparse', workMode, requestedBackend: backend });
  for (let index = 0; index < 4; index++) collector.observe(samplePayload({ backend,
    hit: workMode === 'result-cache', enabled: workMode === 'result-cache' }), { phase: 'measured', queryIndex: 0, durationMs: mean });
  return { schemaVersion: SEARCH_MICRO_REPORT_VERSION, kind: 'search-microbenchmark',
    repoRoot: path.resolve('.tmp/micro-original-repo'), mode: 'code', backend, workMode,
    querySchedule: captureMicroQuerySchedule(query), codeProvenance: { state: 'clean-revision', revision: 'a'.repeat(40) },
    env: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch, cpuModel: 'controlled-fixture-cpu', cpuCount: 4 },
    components: { 'search-sparse': { scoreMode: 'sparse', requestedBackend: backend, samples: 4,
      meanMs: mean, p50Ms: mean, p95Ms: mean, p99Ms: mean, totalTimeMs: mean * 4, work: collector.snapshot() } } };
};
const baseline = makeReport(), current = makeReport({ mean: 50 });
const comparable = compareSearchMicroBaseline(current, baseline);
assert.equal(comparable.state, 'comparable'); assert.equal(comparable.deltas['search-sparse'].meanPct, -50);
current.codeProvenance.revision = 'b'.repeat(40);
assert.equal(compareSearchMicroBaseline(current, baseline).state, 'comparable', 'source revision changes are the intended code experiment');
const cases = [
  ['repo', report => { report.repoRoot = path.resolve('.tmp/other-repo'); }],
  ['query', report => { report.querySchedule = captureMicroQuerySchedule('different query'); }],
  ['query-order', report => { report.querySchedule = captureMicroQuerySchedule('', ['one', 'two']); }],
  ['forged-schedule-hash', report => { report.querySchedule = { ...report.querySchedule, identity: 'unknown' }; }],
  ['missing-schedule', report => { delete report.querySchedule; }],
  ['mode', report => { report.mode = 'prose'; }],
  ['cache-work', report => { report.workMode = 'result-cache'; }],
  ['backend', report => { report.backend = 'sqlite-fts'; }],
  ['generation', report => { report.components['search-sparse'].work.phases.measured.controls[0].source.generationKey = 'different-generation'; }],
  ['missing-generation', report => { report.components['search-sparse'].work.phases.measured.controls[0].source = {}; }],
  ['policy', report => { report.components['search-sparse'].work.phases.measured.controls[0].policyIdentity = `sqp1-${'b'.repeat(64)}`; }],
  ['output', report => { report.components['search-sparse'].work.phases.measured.controls[0].outputIdentity = `mro1-${'b'.repeat(64)}`; }],
  ['unknown-model', report => { report.components['search-sparse'].work.phases.measured.controls[0].model = { status: 'unqualified' }; }],
  ['model-stub', report => { report.components['search-sparse'].scoreMode = 'dense'; }],
  ['runtime', report => { report.env.abi = 'different'; }],
  ['unknown-host', report => { report.env.cpuModel = 'unknown'; }],
  ['empty-host', report => { report.env.cpuModel = ''; }],
  ['zero-samples', report => { report.components['search-sparse'].samples = 0; }],
  ['absent-mean', report => { delete report.components['search-sparse'].meanMs; }],
  ['false-mean', report => { report.components['search-sparse'].meanMs = false; }],
  ['negative-mean', report => { report.components['search-sparse'].meanMs = -1; }],
  ['zero-mean', report => { report.components['search-sparse'].meanMs = 0; }],
  ['work-count-conflict', report => { report.components['search-sparse'].work.phases.measured.candidateStages = 0; }],
  ['string-work-count', report => { report.components['search-sparse'].work.phases.measured.candidateStages = '4'; }],
  ['missing-embedding-work', report => { delete report.components['search-sparse'].work.phases.measured.queryEmbeddingRequests; }],
  ['conflicting-embedding-work', report => { report.components['search-sparse'].work.phases.measured.queryEmbeddingApiCalls = 1; }],
  ['cache-unknown', report => { report.components['search-sparse'].work.phases.measured.cacheUnknown = 1; }],
  ['cache-policy', report => { report.components['search-sparse'].work.phases.measured.controls[0].cache.strategy = 'other'; }],
  ['unknown-cache-policy', report => { delete report.components['search-sparse'].work.phases.measured.controls[0].cache; }],
  ['drift', report => { report.components['search-sparse'].work.phases.measured.controlDrift = 1; }],
  ['missing-work', report => { delete report.components['search-sparse'].work; }],
  ['malformed-controls', report => { report.components['search-sparse'].work.phases.measured.controls = {}; }],
  ['null-control', report => { report.components['search-sparse'].work.phases.measured.controls = [null]; }],
  ['unknown-component', report => { report.components['not-a-component'] = report.components['search-sparse']; }]
];
for (const [label, mutate] of cases) {
  const changed = structuredClone(current); mutate(changed);
  const result = compareSearchMicroBaseline(changed, baseline);
  assert.equal(result.state, 'incomparable', label); assert.deepEqual(result.deltas, {}, label);
  assert.ok(result.differences.length > 0, label);
}
const otherBackend = makeReport({ backend: 'sqlite', mean: 50 });
assert.equal(compareSearchMicroBaseline(otherBackend, baseline).state, 'incomparable');
const intentional = compareSearchMicroBaseline(otherBackend, baseline, { variedAxis: 'backend' });
assert.equal(intentional.state, 'comparable'); assert.equal(intentional.experiment.variedAxis, 'backend');
const unexercised = structuredClone(otherBackend);
unexercised.components['search-sparse'].work.phases.measured.controls[0].backend.effective = 'memory';
assert.equal(compareSearchMicroBaseline(unexercised, baseline, { variedAxis: 'backend' }).state, 'incomparable');
const annReport = makeReport();
const dense = annReport.components['search-sparse']; delete annReport.components['search-sparse'];
annReport.components['search-dense'] = dense; dense.scoreMode = 'dense';
const annCollector = createSearchMicroCollector({ mode: 'code', scoreMode: 'dense', workMode: 'retrieval', requestedBackend: 'memory' });
for (let index = 0; index < 4; index++) annCollector.observe(samplePayload({ ann: true }), { phase: 'measured', queryIndex: 0, durationMs: 100 });
dense.work = annCollector.snapshot();
dense.work.phases.measured.controls[0].model = { status: 'observed', modelId: 'controlled-model', provider: 'stub',
  dimensions: 8, stub: true, artifactStatus: 'stub', artifactIdentity: `stub:embeddings-v${EMBEDDING_IDENTITY_VERSION}`, inputFormatIdentity: `eif1-${'e'.repeat(64)}` };
assert.equal(compareSearchMicroBaseline(annReport, structuredClone(annReport)).state, 'comparable', 'fully observed model controls have a positive comparator case');
for (const [field, value] of [['modelId', 'other'], ['provider', 'other'], ['dimensions', 16], ['stub', false],
  ['artifactIdentity', `sha256:${'f'.repeat(64)}`], ['inputFormatIdentity', `eif1-${'f'.repeat(64)}`]]) {
  const changed = structuredClone(annReport);
  changed.components['search-dense'].work.phases.measured.controls[0].model[field] = value;
  assert.equal(compareSearchMicroBaseline(changed, annReport).state, 'incomparable', field);
}
const unknownDimensions = structuredClone(annReport);
unknownDimensions.components['search-dense'].work.phases.measured.controls[0].model.dimensions = null;
assert.equal(compareSearchMicroBaseline(unknownDimensions, unknownDimensions).state, 'incomparable');
for (const historical of [null, {}, { components: baseline.components }, { ...baseline, schemaVersion: 1 }]) {
  assert.equal(compareSearchMicroBaseline(current, historical).state, 'incomparable');
}
const cache = makeReport({ workMode: 'result-cache', mean: 30 });
assert.equal(compareSearchMicroBaseline(cache, structuredClone(cache)).state, 'comparable');
cache.components['search-sparse'].work.phases.measured.candidateStages = 1;
assert.equal(compareSearchMicroBaseline(cache, structuredClone(cache)).state, 'incomparable');
console.log('Search microbenchmark baselines require matching observed work, source, query, model and runtime controls.');

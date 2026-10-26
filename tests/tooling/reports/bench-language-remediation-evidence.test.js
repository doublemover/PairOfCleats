#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { createBenchQueryOutcomeCollector } from '../../../tools/bench/language/query-outcomes.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { BENCH_REMEDIATION_VERSION } from '../../../src/contracts/benchmark-remediation.js';

ensureTestingEnv(process.env);
const workload = suffix => `qp2:${suffix.repeat(64)}`;
const expected = [{ file: 'src/expected.js', mode: 'code' }];
const irrelevant = { file: 'src/irrelevant.js', start: 0, end: 4, chunkUid: 'irrelevant-chunk' };
const collect = ({ judgment, hits = [], concurrency = 1, serviceMs = 30, workloadKey = workload('a') } = {}) => {
  const collector = createBenchQueryOutcomeCollector({ workloadKey, concurrency });
  for (let index = 0; index < 4; index++) collector.observe({ backend: 'memory', mode: 'code',
    expected: judgment, stratum: 'symbol', payload: { code: hits,
      stats: { elapsedMs: serviceMs }, retrieval: { cache: { hit: false } } } });
  return collector.snapshot();
};
const negative = collect({ judgment: [] });
const positive = collect({ judgment: expected });
const unjudged = collect();
const irrelevantPositive = collect({ judgment: expected, hits: [irrelevant] });
const makeTask = (repo, evidence, overrides = {}) => ({ language: 'javascript', tier: 'small', repo,
  summary: { backends: ['memory'], queries: 4, hitRate: { memory: 0 }, resultCountAvg: { memory: 0 },
    queryWallMsPerSearch: 500, queryOutcomeEvidence: evidence, ...overrides } });
const tasks = [
  makeTask('negative', negative), makeTask('positive', positive), makeTask('unjudged', unjudged),
  makeTask('irrelevant-positive', irrelevantPositive, { hitRate: { memory: 1 }, resultCountAvg: { memory: 1 } }),
  makeTask('unjudged-filled', collect({ hits: [irrelevant] }), { hitRate: { memory: 1 } }),
  makeTask('weights-changed', collect({ workloadKey: workload('b') })),
  makeTask('concurrency-one', collect({ concurrency: 1 }), { queryWallMsPerSearch: 500 }),
  makeTask('concurrency-four', collect({ concurrency: 4 }), { queryWallMsPerSearch: 125 }),
  makeTask('service-one', collect({ concurrency: 1, serviceMs: 250 })),
  makeTask('service-four', collect({ concurrency: 4, serviceMs: 250 }), { queryWallMsPerSearch: 50 }),
  makeTask('cause-tokenizer', unjudged, { causeEvidence: { tokenizer: true, chunking: false } }),
  makeTask('cause-chunking', unjudged, { causeEvidence: { tokenizer: false, chunking: true } }),
  makeTask('taxonomy', unjudged, { missTaxonomy: { byBackend: { memory: { lexical: 4 } },
    lowHitByBackend: { memory: { lexical: 3 } } } }),
  makeTask('unknown-values', null, { hitRate: { memory: null, sqlite: false, 'sqlite-fts': '0' } }),
  makeTask('malformed-evidence', { ...unjudged, cohorts: [{ ...unjudged.cohorts[0], knownPositive: 100 }] }),
  makeTask('one-backend-fails', { ...positive, cohorts: [positive.cohorts[0],
    { ...positive.cohorts[0], backend: 'sqlite', nonempty: 4, empty: 0, positiveTargetFound: 4, positiveTargetMissing: 0 }] },
  { hitRate: { memory: 0, sqlite: 1 } })
];
const output = await buildReportOutput({ configPath: path.join(process.cwd(), 'benchmarks', 'repos.json'),
  cacheRoot: resolveTestCachePath(process.cwd(), 'remediation-evidence-cache'),
  resultsRoot: resolveTestCachePath(process.cwd(), 'remediation-evidence-results'), results: tasks,
  config: { javascript: { label: 'JavaScript' } } });
const remediation = output.remediation;
const row = repo => {
  const found = remediation.lowHitRepos.find(entry => entry.repo === repo);
  assert.ok(found, `${repo} must be represented`);
  return found;
};
const diagnosis = repo => row(repo).cohorts[0].diagnosis;
assert.equal(remediation.schemaVersion, BENCH_REMEDIATION_VERSION);
assert.equal(diagnosis('negative'), 'expected-empty-success');
assert.equal(diagnosis('positive'), 'judged-positive-target-missing');
assert.equal(diagnosis('unjudged'), 'expectations-unknown');
assert.equal(row('negative').severityScore, 0);
assert.equal(row('negative').rankedSuggestions[0].applicability, 'no-retrieval-remediation-indicated');
assert.equal(row('positive').cohorts[0].positiveTargetFoundRate, 0);
assert.equal(row('irrelevant-positive').cohorts[0].positiveTargetFoundRate, 0);
assert.equal(row('irrelevant-positive').cohorts[0].nonemptyRate, 1);
assert.equal(row('positive').severityScore, row('irrelevant-positive').severityScore,
  'irrelevant extra results cannot improve judged target success');
assert.equal(remediation.lowHitRepos.some(entry => entry.repo === 'unjudged-filled'), false);
assert.equal(remediation.qualityDelta.status, 'unavailable');
assert.equal(remediation.qualityDelta.workloadChanges, 'workload-design-change-not-product-quality-gain');
assert.notEqual(row('unjudged').workloadKey, row('weights-changed').workloadKey);
const ids = repo => row(repo).rankedSuggestions.map(entry => entry.suggestionId);
assert.deepEqual(ids('concurrency-one'), ids('concurrency-four'));
assert.equal(ids('concurrency-one').includes('performance.inspect-service-latency'), false,
  'batch wall-per-completion must not become query latency');
assert.deepEqual(ids('service-one'), ids('service-four'));
assert.ok(ids('service-one').includes('performance.inspect-service-latency'));
assert.ok(!ids('service-one').includes('ranker.rerank-budget'), 'service time does not establish rerank attribution');
for (const repo of ['cause-tokenizer', 'cause-chunking']) {
  assert.equal(row(repo).causeAttribution, 'unverified');
  assert.ok(row(repo).rankedSuggestions.every(entry => entry.qualification === 'not-a-qualified-production-change'));
}
assert.deepEqual(ids('cause-tokenizer'), ids('cause-chunking'), 'unqualified cause flags cannot authorize a remedy');
const label = row('taxonomy').missTaxonomyTop[0];
assert.equal(label.total, 4); assert.equal(label.zeroHit, 3); assert.equal(label.count, 4);
assert.equal(label.scope, 'backend-search-occurrences');
assert.equal(row('one-backend-fails').cohorts.find(entry => entry.backend === 'memory').positiveTargetMissing, 4);
assert.equal(row('one-backend-fails').bestHitRate, 1, 'historical maximum remains display-only');
assert.equal(row('malformed-evidence').evidenceStatus, 'invalid-outcome-evidence');
assert.equal(remediation.lowHitRepos.some(entry => entry.repo === 'unknown-values'), false);
assert.equal(remediation.loop.acceptedSuggestions, 0);
assert.equal(remediation.loop.postChangeDeltaReady, false);
for (const entry of remediation.lowHitRepos.flatMap(entry => entry.rankedSuggestions)) {
  assert.equal(entry.loop.accepted, false); assert.equal(entry.loop.postChange, null); assert.equal(entry.loop.delta, null);
  assert.equal(entry.calibratedProbability, false);
}
console.log('Language remediation distinguishes judged outcomes, workload changes, source scope and service observations.');

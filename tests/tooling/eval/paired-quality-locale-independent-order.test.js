import assert from 'node:assert/strict';
import { QUALITY_COMPARISON_VERSION } from '../../../src/contracts/schemas/quality-comparison.js';
import { comparePairedQuality } from '../../../src/retrieval/evaluation/paired-quality.js';
import { evaluateTaskSpanTrace } from '../../../src/retrieval/evaluation/task-span-trace.js';
import { makeTaskSpanTrace, taskTraceFixtureHash as hash } from '../../helpers/task-span-trace-fixture.js';

const repositories = ['Z', 'é', 'a', '雪'], families = ['É-family', 'z-family', 'a-family', 'É-family'];
const request = { schemaVersion: QUALITY_COMPARISON_VERSION, kind: 'paired-quality-comparison',
  metric: { name: 'declared-quality', definitionKey: hash('locale-independent-fixture'), unit: 'quality-unit-interval' },
  baselineKey: hash('baseline'), candidateKey: hash('candidate'), cluster: 'repository', seed: 'fixed-code-unit-order', resamples: 64, slices: [],
  ...Object.fromEntries(['baseline', 'candidate'].map(side => [side, repositories.map((repoId, index) => ({ taskKey: hash(repoId),
    inputKey: hash(`${repoId}:source`), repoId, familyId: families[index], slice: 'quality', status: 'complete', value: side === 'baseline' ? 0 : index / 4 }))])) };
const before = await comparePairedQuality(request);
const familyRequest = { ...request, cluster: 'family' }, familyBefore = await comparePairedQuality(familyRequest);
const trace = makeTaskSpanTrace();
for (const id of ['Z-claim', 'é-claim']) trace.claims.push({ id, statementDigest: hash(id), citations: [], label: 'unknown',
  judge: { kind: 'unjudged', identityKey: null } });
const traceBefore = await evaluateTaskSpanTrace(trace);
const original = String.prototype.localeCompare; let localeCalls = 0;
try {
  String.prototype.localeCompare = function(other, ...options) { localeCalls++; return -original.call(this, other, ...options); };
  assert.deepEqual(await comparePairedQuality(request, { resumeKey: before.checkpoint.key }), before);
  assert.deepEqual(await comparePairedQuality(familyRequest, { resumeKey: familyBefore.checkpoint.key }), familyBefore);
  assert.deepEqual(await evaluateTaskSpanTrace(trace, { resumeKey: traceBefore.traceKey }), traceBefore);
  assert.equal(localeCalls, 0, 'machine identities, group order and resampling must not consult host collation');
} finally { String.prototype.localeCompare = original; }
assert.match(before.policy, /code-unit\.xorshift32\.v2/);
console.log('Saved quality/trace source identities and seeded draws are independent of locale collation; assertions unvalidated');

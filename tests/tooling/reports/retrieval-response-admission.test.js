import assert from 'node:assert/strict';
import { selectRetrievalCohort, admitComparisonResponse } from '../../../tools/shared/retrieval-result-admission.js';
import { createRetrievalEvidenceRegistry } from '../../../tools/shared/retrieval-execution-evidence.js';
import { createFixtureRetrievalMetadata } from '../../helpers/retrieval-response-fixture.js';

const hit = { file: 'source.js', chunkUid: 'fixture:1', score: 0 };
const metadata = createFixtureRetrievalMetadata({ fixtureId: 'response-admission-v1', backend: 'memory' });
const admit = payload => admitComparisonResponse(payload, ['code', 'prose'], {
  registry: createRetrievalEvidenceRegistry(), expectedBackend: 'memory'
});
for (const payload of [null, [], {}, { ok: false, code: [], prose: [] }, { code: null, prose: [] },
  { code: {}, prose: [] }, { code: [null], prose: [] }, { code: [false], prose: [] }, { code: new Array(1), prose: [] },
  { code: [hit], prose: [], outputBudget: { truncated: false, omittedHits: 1 } },
  { code: [], prose: [], outputBudget: { truncated: true } }]) {
  const observed = admit(payload);
  assert.equal(observed.admission.state, 'unavailable');
  assert.equal(observed.admission.qualified, false);
  assert.equal(observed.cohorts.code, null, 'unavailable code cannot become an explicit empty list');
}
const empty = admit({ code: [], prose: [], retrieval: metadata });
assert.equal(empty.admission.state, 'available');
assert.equal(empty.admission.qualified, true);
assert.deepEqual(empty.cohorts, { code: [], prose: [] });
const partial = admit({ code: null, prose: [hit], retrieval: metadata });
assert.equal(partial.admission.byMode.code.state, 'unavailable');
assert.equal(partial.admission.byMode.prose.qualified, true, 'valid sibling cohorts retain their own observations');
assert.equal(partial.cohorts.prose.length, 1);
const original = { code: [{ ...hit }], prose: [], retrieval: metadata,
  outputBudget: { truncated: true, omittedHits: 0 } };
const positive = admit(original);
original.code[0].file = 'mutated-after-admission.js';
assert.equal(positive.cohorts.code[0].file, 'source.js');
assert.throws(() => positive.cohorts.code.push(hit), TypeError);
assert.equal(positive.cohorts.code[0].score, 0, 'measured zero remains data');
let calls = 0;
const accessor = { prose: [], retrieval: metadata };
Object.defineProperty(accessor, 'code', { get() { calls++; return []; } });
assert.equal(admit(accessor).admission.state, 'unavailable');
assert.equal(calls, 0);
const mixedBackend = admitComparisonResponse({ code: [hit], prose: [], retrieval: metadata }, ['code', 'prose'], {
  registry: createRetrievalEvidenceRegistry(), expectedBackend: 'sqlite'
});
assert.equal(mixedBackend.admission.qualified, false);
assert.ok(mixedBackend.admission.reasons.includes('observed-backend-mismatch'));
assert.throws(() => selectRetrievalCohort({ records: [] }, 'code'), { code: 'ERR_RETRIEVAL_RESPONSE' });
console.log('shared retrieval response admission preserves selected cohorts, passive evidence and observed route');

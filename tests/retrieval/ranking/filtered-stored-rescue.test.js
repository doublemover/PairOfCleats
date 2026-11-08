import assert from 'node:assert/strict';
import { openFilteredStoredVectorSession } from '../../../src/retrieval/sessions/filtered-stored.js';

const target = { scoreTarget: 'stored-dot-scalar-v1', eligibility: 'complete-confirmed', repositoryId: 'repo', generationId: 'build',
  rowMapId: 'rows', representationId: 'quantized-1d', queryId: 'query', eligibleDomainId: 'eligible' };
const idx = { denseVec: { dims: 1, minVal: 0, maxVal: 255, scale: 1, levels: 256,
  vectors: [[1], [100], [50], [200]] } };
const eligibleRows = [{ rowId: 0, id: 'low' }, { rowId: 1, id: 'middle' }, { rowId: 3, id: 'winner' }];
let releases = 0;
const snapshotLease = { assertActive: expected => assert.deepEqual(expected, target), release: () => releases++ };
const session = openFilteredStoredVectorSession({ target, idx, embedding: [1], eligibleRows, snapshotLease,
  probe: async () => ({ ids: [0, 2], actualWork: 1 }) });
const first = await session.advance({ workBudget: 2, topK: 1 });
assert.equal(first.hits[0].id, 'low');
assert.equal(first.hits[0].orderStatus, 'provisional', 'nonempty full page cannot terminate exact rescue');
assert.equal(first.counters.rejectedProbeIds, 1);
let last;
do { last = await session.advance({ workBudget: 1, topK: 3, cursor: first.continuation }); } while (last.state === 'running');
assert.deepEqual(last.hits.map(hit => hit.id), ['winner', 'middle', 'low']);
assert.equal(last.counters.scoresComputed, 3, 'shared authoritative cache avoids rescoring probe hits');
assert.equal(last.hits[0].orderStatus, 'certified');
assert.equal(last.originalVectorExactness, 'not-claimed');
session.close(); session.close(); assert.equal(releases, 1);
const failedProbe = openFilteredStoredVectorSession({ target, idx, embedding: [1], eligibleRows, snapshotLease,
  probe: async () => { throw new Error('native unavailable'); } });
const rescued = await failedProbe.advance({ workBudget: 10 });
assert.equal(rescued.state, 'exhausted');
assert.equal(rescued.probeFailures.length, 1);
assert.equal(rescued.hits[0].id, 'winner');
failedProbe.close();
const controller = new AbortController(); controller.abort();
const paused = openFilteredStoredVectorSession({ target, idx, embedding: [1], eligibleRows, snapshotLease });
const cancelled = await paused.advance({ signal: controller.signal });
assert.equal(cancelled.state, 'paused'); assert.equal(cancelled.eligibleEnumerationComplete, false);
await assert.rejects(paused.advance({ expectedTargetId: 'different' }), /Incompatible/);
assert.equal((await paused.advance({ workBudget: 10 })).hits[0].id, 'winner'); paused.close();
console.log('filtered stored-vector exact rescue contract passed');

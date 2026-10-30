import assert from 'node:assert/strict';
import { createSearchPipeline } from '../../../src/retrieval/pipeline.js';
import { ANN_PROVIDER_IDS } from '../../../src/retrieval/ann/types.js';
import { buildAnnPipelineFixture } from './helpers/ann-scenarios.js';

const run = async (shadowRouting, query = 'why does this function fail') => {
  let queries = 0;
  const fixture = buildAnnPipelineFixture({ createAnnProviders: () => new Map([[ANN_PROVIDER_IDS.DENSE, {
    id: ANN_PROVIDER_IDS.DENSE, isAvailable: () => true,
    query: async () => { queries++; return [{ idx: 0, sim: 0.9 }, { idx: 1, sim: 0.8 }]; }
  }]]) });
  fixture.context.query = query; fixture.context.shadowRouting = shadowRouting;
  const snapshot = structuredClone(fixture.idx.chunkMeta);
  const hits = await createSearchPipeline(fixture.context)(fixture.idx, 'code', [0.1, 0.2]);
  assert.deepEqual(fixture.idx.chunkMeta, snapshot, 'shadow features never mutate cached source members');
  return { hits, serialized: JSON.stringify(hits), queries,
    report: fixture.stageTracker.stages.find(row => row.stage === 'ann').shadowRouting };
};
const control = await run(false), observed = await run(true);
assert.equal(observed.serialized, control.serialized); assert.deepEqual(observed.hits, control.hits);
assert.equal(observed.queries, control.queries); assert.equal(control.report, undefined);
assert.equal(observed.report.authoritative, false); assert.equal(observed.report.label, 'natural-language');
const unknown = await run(true, null);
assert.equal(unknown.report.complete, false); assert.equal(unknown.serialized, control.serialized,
  'unavailable shadow query text does not fail or replace primary results');
console.log('Actual primary pipeline preserves serialized hits, source metadata and provider call count with shadow instrumentation');

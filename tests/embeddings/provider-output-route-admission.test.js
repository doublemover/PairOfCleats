import assert from 'node:assert/strict';
import { createXenovaAdapter } from '../../src/shared/embedding-provider-adapters.js';
import { errorGraphIncludes, errorGraphSome } from '../helpers/error-graph.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();
const malformed = [
  () => [[1, 2], [3, 4]], () => [], () => [['1', '2']], () => [[1]],
  () => ({ dims: [2, 2], data: Float32Array.of(1, 2, 3, 4) }),
  () => ({ dims: [1, 3], data: Float32Array.of(1, 2) }),
  () => ({ dims: [3], data: Float32Array.of(1, 2) }),
  () => ({ dims: [1, 2], data: Float32Array.of(1, 2, 3) }),
  () => ({ dims: [1, 0], data: new Float32Array(0) }),
  () => ({ dims: [1, 1.5], data: Float32Array.of(1, 2) }),
  () => ({ dims: [], data: Float32Array.of(1) }),
  () => ({ dims: [1, 1, 2], data: Float32Array.of(1, 2) }),
  () => ({ dims: [1, 2], type: 'int32', data: Int32Array.of(1, 2) }),
  () => ({ dims: [1, 2], type: 'float64', data: Float32Array.of(1, 2) }),
  () => [[NaN, 2]], () => [[Number.MAX_VALUE, 2]]
];
const invoke = (adapter, route) => route === 'single' ? adapter.embedOne('fixture')
  : route === 'prepared' ? adapter.embedPrepared([{ input: 'fixture' }]) : adapter.embed(['fixture']);
for (const route of ['batch', 'single', 'prepared']) {
  for (const create of [...malformed, () => ({ dims: [1, 2], type: 'float32', data: Float32Array.of(1, 2) })]) {
    let outputCloses = 0, pipelineCloses = 0;
    const output = create(), valid = malformed.every(factory => factory !== create);
    if (!Array.isArray(output)) output.dispose = async () => { outputCloses++; output.data.fill(0); };
    const pipeline = async () => output;
    pipeline.embedPrepared = async () => output; pipeline.dispose = async () => { pipelineCloses++; };
    const adapter = createXenovaAdapter({ modelId: 'route-admission-fixture', dims: 2,
      loadPipeline: async () => pipeline });
    try {
      if (valid) {
        const result = await invoke(adapter, route), vector = route === 'single' ? result : result[0];
        assert.deepEqual([...vector], [1, 2], 'owned tensor bytes are copied before native output disposal');
      } else await assert.rejects(invoke(adapter, route), error => errorGraphSome(error, value => value?.code === 'ERR_EMBEDDING_OUTPUT'));
      assert.equal(outputCloses, Array.isArray(output) ? 0 : 1, `${route} settles owned output on success and validation failure`);
    } finally { await adapter.dispose(); }
    assert.equal(pipelineCloses, 1);
  }
  let closes = 0;
  const cleanupFailure = new Error('original output cleanup failed');
  const output = { dims: [1, 3], data: Float32Array.of(1, 2), dispose: async () => { if (++closes === 1) throw cleanupFailure; } };
  const pipeline = async () => output; pipeline.embedPrepared = async () => output; pipeline.dispose = async () => {};
  const adapter = createXenovaAdapter({ modelId: 'route-cleanup-fixture', dims: 2, loadPipeline: async () => pipeline });
  let failure;
  await assert.rejects(invoke(adapter, route), error => {
    failure = error;
    return errorGraphIncludes(error, cleanupFailure) && errorGraphSome(error, value => value?.code === 'ERR_EMBEDDING_OUTPUT');
  });
  assert.equal(closes, 1); assert.equal(failure.cacheOwnershipReleased(), false);
  await assert.rejects(adapter.dispose(), error => errorGraphIncludes(error, cleanupFailure));
  assert.equal(closes, 1, 'first adapter shutdown observes the failed owner without an implicit disposal retry');
  await adapter.dispose(); assert.equal(closes, 2); assert.equal(failure.cacheOwnershipReleased(), true);
}
// A subarray owns its exact view, and a generic unconfigured provider learns a
// width only from its first admitted output, then holds it across every route.
let current = Float32Array.of(9, 1, 2, 9).subarray(1, 3);
const pipeline = async () => ({ dims: [1, current.length], data: current });
pipeline.embedPrepared = async () => ({ dims: [1, current.length], data: current }); pipeline.dispose = async () => {};
const adapter = createXenovaAdapter({ modelId: 'learned-width-fixture', loadPipeline: async () => pipeline });
try {
  assert.deepEqual([...(await adapter.embedOne('first'))], [1, 2]);
  current = Float32Array.of(1, 2, 3);
  await assert.rejects(adapter.embedPrepared([{}]), { code: 'ERR_EMBEDDING_OUTPUT' });
  await assert.rejects(adapter.embedOne('second'), { code: 'ERR_EMBEDDING_OUTPUT' });
} finally { await adapter.dispose(); }
console.log('Actual provider batch/single/prepared routes reject original shape/cardinality/dtype evidence and settle native output ownership.');

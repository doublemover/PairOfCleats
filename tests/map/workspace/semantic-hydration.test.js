import assert from 'node:assert/strict';
import { semanticDetailInput, createRequestController } from '../../../src/map/workspace/request.js';
import { projectOutput } from '../../../src/map/workspace/projection.js';
import { assertSemanticQuery } from '../../../src/contracts/validators/semantic-query.js';
import { sourceFixture } from './source-fixture.js';

const { result } = sourceFixture();
for (const operation of ['find', 'detail', 'trace']) {
  const projection = projectOutput(result);
  const input = semanticDetailInput(projection.nodes[0], projection, '/selected/repository');
  assertSemanticQuery('detailRequest', input);
  assert.equal(input.repoRoot, '/selected/repository', operation);
  assert.deepEqual(input.generation, result.generation);
  assert.deepEqual(input.refs, [result.records[0].ref]);
}
const ref = result.records[0].ref, generation = { baseBuildId: 'wrapper-build', semanticRevision: 0 };
assert.deepEqual(semanticDetailInput({ detail: { ref, generation } }, { generation: result.generation }, '.').generation,
  generation, 'artifact wrapper generation takes precedence over its catalog envelope');
for (const invalid of [null, 'opaque-catalog-generation', { baseBuildId: '', semanticRevision: 0 },
  { baseBuildId: 'future', semanticRevision: 1 }, { ...generation, extra: true }]) {
  assert.equal(semanticDetailInput({ ref }, { generation: invalid }, '.'), null);
}
assert.equal(semanticDetailInput({ ref: { partitionId: '../../outside', localId: 0 } }, { generation }, '.'), null);
assert.equal(semanticDetailInput({ ref: { ...ref, localId: -1 } }, { generation }, '.'), null);
for (const invalid of [null, undefined, false, { ...generation, extra: true }]) {
  assert.equal(semanticDetailInput({ detail: { ref, generation: invalid } }, { generation }, '.'), null, 'an explicit invalid wrapper cannot borrow envelope authority');
}
let getterReads = 0;
const accessorRef = Object.defineProperty({ localId: 0 }, 'partitionId', { get() { getterReads++; return ref.partitionId; } });
assert.equal(semanticDetailInput({ ref: accessorRef }, { generation }, '.'), null);
assert.equal(getterReads, 0, 'decoded hydration fields never invoke caller accessors');
const originalRef = { ...ref }, originalGeneration = { ...generation };
const captured = semanticDetailInput({ ref: originalRef }, { generation: originalGeneration }, '.');
originalRef.localId++; originalGeneration.baseBuildId = 'changed-after-selection';
assert.deepEqual(captured.refs, [ref]); assert.deepEqual(captured.generation, generation, 'the selected source and generation are captured values');
let deliver;
const pending = new Promise(resolve => { deliver = resolve; });
const requests = createRequestController({ fetchFn: () => pending });
const expected = { ...generation }, request = requests.request('detail', {}, { expectedGeneration: expected });
expected.baseBuildId = 'mutated-while-pending';
deliver(new Response(JSON.stringify({ generation: expected })));
await assert.rejects(request, /Generation mismatch/, 'caller mutation cannot change the original expected generation');
console.log('Canonical semantic records hydrate with validated envelope generation and retained repository scope');

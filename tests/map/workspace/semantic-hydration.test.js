import assert from 'node:assert/strict';
import { semanticDetailInput } from '../../../src/map/workspace/request.js';
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
console.log('Canonical semantic records hydrate with validated envelope generation and retained repository scope');

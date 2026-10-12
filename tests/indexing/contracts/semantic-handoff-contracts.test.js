#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { SEMANTIC_MEMBER_NAMES } from '../../../src/contracts/schemas/semantic-envelopes.js';
import { assertSemanticEnvelope } from '../../../src/contracts/validators/semantic-envelopes.js';
import { assertSemanticQuery } from '../../../src/contracts/validators/semantic-query.js';
const source = createSemanticSourceSnapshot({ bytes: Buffer.from('f(1);'), repositoryNamespace: 'fixture-repo', path: 'input.js', language: 'javascript' }).manifest;
const partitionId = createSyntaxPartitionId({ sourceUnitId: source.sourceUnitId,
  parser: { family: 'fixture', version: '1', options: {} }, extractor: { version: '1', schemaVersion: 1 }, structuralPolicy: {} });
const partition = { schemaVersion: 1, semanticSchemaVersion: 1, partitionId, sourceUnitId: source.sourceUnitId,
  producerHash: 'a'.repeat(64), contextHash: null, policyHash: 'b'.repeat(64), canonicalHash: 'c'.repeat(64),
  structuralSlots: [], members: Object.fromEntries(SEMANTIC_MEMBER_NAMES.map(name => [name, []])) };
const storage = { generation: { baseBuildId: 'fixture-build', semanticRevision: 0 }, relativePath: 'index-code/semantic' };
const descriptor = createSemanticFactsRef({ source, partitions: [partition], syntaxPartitionId: partitionId, storage, coverage: [] });
assertSemanticEnvelope('fileFactsRef', JSON.parse(JSON.stringify(descriptor)));
const relocated = createSemanticFactsRef({ source, partitions: [partition], syntaxPartitionId: partitionId,
  storage: { generation: { baseBuildId: 'next-build', semanticRevision: 0 }, relativePath: 'new-location/semantic' }, coverage: [] });
assert.equal(relocated.canonicalHash, descriptor.canonicalHash, 'physical relocation cannot change semantic identity');
for (const mutate of [
  value => { value.counts.semantic_records = 1; },
  value => { value.partitions.push(partition); },
  value => { value.partitions[0].sourceUnitId = 'su1:' + 'd'.repeat(64); },
  value => { value.storage.relativePath = '../escape'; },
  value => { value.storage.generation.semanticRevision = 1; },
  value => { value.canonicalHash = 'e'.repeat(64); },
  value => { value.root = 'C:/worker-private'; }
]) {
  const value = structuredClone(descriptor); mutate(value);
  assert.throws(() => assertSemanticEnvelope('fileFactsRef', value), { code: 'ERR_SEMANTIC_CONTRACT' });
}
const request = { repoRoot: 'fixture', generation: storage.generation, refs: [{ partitionId, localId: 0 }] };
assertSemanticQuery('detailRequest', request);
for (const patch of [{ extra: true }, { limits: { records: 0 } }, { limits: { records: 129 } },
  { limits: { edges: 1 } }, { fields: ['unknown'] }, { generation: { baseBuildId: 'fixture-build', semanticRevision: 1 } }]) {
  assert.throws(() => assertSemanticQuery('detailRequest', { ...request, ...patch }), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
}
console.log('semantic portable descriptor and shared request contracts passed');

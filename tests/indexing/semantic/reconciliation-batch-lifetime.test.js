import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';
import { canonicalSemanticJson, semanticHash } from '../../../src/index/semantic/identity.js';
import { SEMANTIC_MEMBER_NAMES } from '../../../src/contracts/schemas/semantic-envelopes.js';

const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const source = Object.freeze({ sourceUnitId: 'su1:' + 'a'.repeat(64), textLength: 0 });
const partitions = Array.from({ length: 8 }, (_, index) => {
  const members = Object.fromEntries(SEMANTIC_MEMBER_NAMES.map(name => [name,
    name === 'semantic_sources' ? [{ count: 1 }] : []]));
  const partition = { partitionId: `sy1:${String(index).padStart(64, '0')}`, sourceUnitId: source.sourceUnitId,
    producerHash: 'b'.repeat(64), contextHash: null, policyHash: 'c'.repeat(64), members };
  const memberHashes = Object.fromEntries(SEMANTIC_MEMBER_NAMES.map(name => [name,
    createHash('sha256').update(name === 'semantic_sources' ? canonicalSemanticJson(source) + '\n' : '').digest('hex')]));
  return { ...partition, canonicalHash: semanticHash('pairofcleats.semantic.partition-content.v1', {
    partitionId: partition.partitionId, sourceUnitId: partition.sourceUnitId, producerHash: partition.producerHash,
    contextHash: partition.contextHash, policyHash: partition.policyHash, memberHashes
  }) };
});

{
  let checks = 0;
  const store = {
    async *iterateRows(id, member) { if (member === 'semantic_sources') yield source; },
    async verifySource() { checks++; await new Promise(resolve => setImmediate(resolve)); }
  };
  await validateSemanticPartitions({ store, partitions });
  assert.equal(checks, 1, 'all partitions await the same actual source verification');
  await assert.rejects(validateSemanticPartitions({ store, partitions: [{ ...partitions[0], canonicalHash: '0'.repeat(64) }] }),
    /canonical content hash mismatch/);
}

{
  const held = gate(), failed = gate(), release = gate(), failure = new Error('original partition read failed');
  const admitted = new Set(), closed = new Set();
  let active = 0, highWater = 0, settled = false;
  const store = {
    async *iterateRows(id, member) {
      if (member !== 'semantic_sources') return;
      admitted.add(id); active++; highWater = Math.max(highWater, active);
      try {
        if (id === partitions[0].partitionId) { await held.promise; throw failure; }
        held.resolve(); await release.promise; yield source;
      } finally { active--; closed.add(id); if (id === partitions[0].partitionId) failed.resolve(); }
    },
    async verifySource() {}
  };
  const result = validateSemanticPartitions({ store, partitions }).then(
    () => { settled = true; return null; }, error => { settled = true; return error; });
  try {
    await failed.promise;
    assert.equal(settled, false, 'failure must wait for independently held original iterators');
    assert.equal(highWater, 4, 'the validation owner admits at most four partition readers');
  } finally { release.resolve(); }
  assert.equal(await result, failure, 'the original partition failure retains its identity');
  assert.equal(active, 0); assert.equal(closed.size, 4);
  assert.equal(admitted.has(partitions[4].partitionId), false, 'failure stops later partition admission');
}
console.log('Semantic reconciliation bounds readers, coalesces actual source verification and drains original I/O.');

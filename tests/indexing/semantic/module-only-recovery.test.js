#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSemanticCollector } from '../../../src/index/semantic/javascript-collector.js';
import { createSemanticPartitionSink } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { parseJavaScriptAst } from '../../../src/lang/javascript/parse.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';

for (const text of ['', '// no chunks 🧭\r\n', 'export {};']) {
  const fixture = await createRecoveryFixture(text);
  try {
    const collector = createSemanticCollector({
      ast: parseJavaScriptAst(text), source: fixture.source, partitionId: fixture.partitionId
    }, { batchRows: 2 });
    const sink = await createSemanticPartitionSink({ ...fixture.options,
      structuralSlots: collector.structuralSlots, batchRows: 2 });
    for (const batch of collector.batches) await sink.appendBatch(batch);
    const descriptor = await sink.finalizeSource();
    const store = fixture.store([descriptor]);
    await validateSemanticPartitions({ store, partitions: [descriptor] });
    const records = [];
    for await (const row of store.iterateRows(fixture.partitionId, 'semantic_records')) records.push(row);
    assert.ok(records.some(row => row.kind === 'scope' && row.data.scopeKind === 'Program'));
    assert.ok(records.every(row => !row.span || row.span[1] <= text.length));
    assert.equal(descriptor.members.semantic_ownership.length, 0);
    const coverage = await store.getCoverage([fixture.partitionId]);
    assert.equal(coverage.find(row => row.phase === 'syntax').state, 'complete');
    assert.ok(coverage.filter(row => row.phase !== 'syntax').every(row => row.state === 'unsupported'),
      'module-only syntax cannot claim unimplemented analysis is complete');
  } finally { await fixture.cleanup(); }
}
console.log('semantic empty, comment-only and module-only source preservation passed');

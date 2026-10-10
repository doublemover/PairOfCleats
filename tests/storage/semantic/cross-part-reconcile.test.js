#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';
import { createAnalysisPartitionId } from '../../../src/index/semantic/identity.js';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';

const fixture = await createRecoveryFixture();
try {
  const syntax = await fixture.write();
  const syntaxRef = { partitionId: syntax.partitionId, localId: 0 };
  const analysisId = createAnalysisPartitionId({ pass: { name: 'fixture-owner', version: '1' },
    inputPartitionHashes: [syntax.canonicalHash], compilerContext: null,
    dependencySummaryHashes: [], analysisPolicy: {} });
  const owner = (ref) => [{ family: 'ownership', row: { recordRef: ref, chunkUid: 'fixture-chunk', role: 'primary' } }];
  const valid = await fixture.write(owner(syntaxRef), { partitionId: analysisId });
  await validateSemanticPartitions({ store: fixture.store([syntax, valid]), partitions: [syntax, valid] });
  await assert.rejects(validateSemanticPartitions({
    store: fixture.store([valid]), partitions: [valid]
  }), /Dangling semantic reference/, 'qualified refs cannot survive removing their target partition');

  const missingId = 'sy1:' + 'f'.repeat(64);
  for (const ref of [{ partitionId: missingId, localId: 0 }, { ...syntaxRef, localId: 1 }]) {
    const invalid = await fixture.write(owner(ref), { partitionId: analysisId });
    await assert.rejects(validateSemanticPartitions({
      store: fixture.store([syntax, invalid]), partitions: [syntax, invalid]
    }), /Dangling semantic reference/);
  }
  // Node payload endpoints are foreign keys too, even when their own IDs are valid.
  const linked = semanticNode(0, fixture.source.textLength);
  linked.row.scope = { partitionId: missingId, localId: 0 };
  const invalidNode = await fixture.write([linked]);
  await assert.rejects(validateSemanticPartitions({
    store: fixture.store([invalidNode]), partitions: [invalidNode]
  }), /Dangling semantic reference/);

  await assert.rejects(validateSemanticPartitions({
    store: fixture.store([syntax]), partitions: [{ ...syntax, canonicalHash: 'e'.repeat(64) }]
  }), /canonical content hash/);
  const corruptCount = structuredClone(syntax);
  corruptCount.members.semantic_records[0].count += 1;
  await assert.rejects(validateSemanticPartitions({
    store: fixture.store([syntax]), partitions: [corruptCount]
  }), /count mismatch/);
  assert.deepEqual(await fs.readFile(fixture.original), fixture.bytes);
  console.log('semantic qualified references, member counts and canonical reconciliation passed');
} finally { await fixture.cleanup(); }

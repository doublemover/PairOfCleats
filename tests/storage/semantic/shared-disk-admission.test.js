#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSemanticPartitionSink, createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { createRecoveryFixture, semanticBatch, semanticNode } from '../../helpers/semantic-recovery.js';

const fixture = await createRecoveryFixture();
try {
  const batch = semanticBatch(fixture.partitionId, [semanticNode(0, fixture.source.textLength)]);
  // Entry envelopes are producer costs; persisted parts only contain the inner row.
  const rowBytes = Buffer.byteLength(JSON.stringify(batch.rows[0].row)) + 1;
  const account = createSemanticDiskAccount(rowBytes + 8);
  const first = await createSemanticPartitionSink({ ...fixture.options, diskAccount: account });
  const second = await createSemanticPartitionSink({ ...fixture.options, diskAccount: account });
  await first.appendBatch(batch);
  assert.equal(account.used, account.limit, 'first sink occupies the exact shared part allowance');
  await assert.rejects(second.appendBatch(batch), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  assert.equal(account.used, account.limit, 'failed second sink cannot release first sink credits');
  assert.equal((await fixture.partDirectories()).length, 1);
  await first.abort();
  assert.equal(account.used, 0);
  const retry = await createSemanticPartitionSink({ ...fixture.options, diskAccount: account });
  await retry.appendBatch(batch);
  await assert.rejects(retry.finalizeSource(), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  assert.equal(account.used, 0, 'failed source admission rolls back all owned part credits');
  assert.deepEqual(await fixture.partDirectories(), []);
  assert.throws(() => account.release(1), /underflow/);
  console.log('semantic exact shared disk admission and independent rollback passed');
} finally { await fixture.cleanup(); }

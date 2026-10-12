#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSemanticPartitionSink } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { createRecoveryFixture, semanticBatch, semanticNode } from '../../helpers/semantic-recovery.js';

const fixture = await createRecoveryFixture('/* retained original 🧭 */\r\nf(1);');
try {
  const rows = [semanticNode(0, fixture.source.textLength)];
  const before = new AbortController();
  before.abort();
  const unopened = await createSemanticPartitionSink({ ...fixture.options, signal: before.signal });
  await assert.rejects(unopened.appendBatch(semanticBatch(fixture.partitionId, rows)), { name: 'AbortError' });
  await unopened.abort();
  assert.equal(fixture.account.used, 0);
  assert.deepEqual(await fixture.partDirectories(), []);

  const flushed = new AbortController();
  const sink = await createSemanticPartitionSink({ ...fixture.options, signal: flushed.signal });
  await sink.appendBatch(semanticBatch(fixture.partitionId, rows));
  assert.ok(fixture.account.used > 0);
  flushed.abort();
  await assert.rejects(sink.finalizeSource(), { name: 'AbortError' });
  await sink.abort();
  await sink.abort();
  assert.equal(fixture.account.used, 0, 'part credits released once after flushed cancellation');
  assert.deepEqual(await fixture.partDirectories(), []);

  const duringFinalize = new AbortController();
  let calls = 0;
  const retaining = await createSemanticPartitionSink({ ...fixture.options, signal: duringFinalize.signal,
    scheduleIo: async (fn) => { if (++calls === 2) duringFinalize.abort(); return fn(); } });
  await retaining.appendBatch(semanticBatch(fixture.partitionId, rows));
  await assert.rejects(retaining.finalizeSource(), { name: 'AbortError' });
  assert.deepEqual(await fixture.partDirectories(), [], 'failed finalization cannot leave an incomplete part');
  const blob = path.join(fixture.stagingRoot, 'semantic-sources', fixture.source.byteHash + '.utf8');
  assert.deepEqual(await fs.readFile(blob), fixture.bytes, 'shared retained source remains exact');
  assert.equal(fixture.account.used, fixture.bytes.length, 'existing immutable source bytes remain charged');
  const descriptor = await fixture.write(rows);
  const retainedAfterRetry = fixture.account.used;
  const another = await fixture.write(rows);
  const partCost = Object.values(another.members).flat().reduce((n, piece) => n + piece.bytes + piece.count * 8, 0);
  assert.equal(fixture.account.used - retainedAfterRetry, partCost, 'retry reuses retained source without charging twice');
  assert.equal(descriptor.canonicalHash, another.canonicalHash);
  assert.deepEqual(await fs.readFile(fixture.original), fixture.bytes, 'all cancellation paths preserve the original');
  console.log('semantic cancellation before flush, after flush and after source retention passed');
} finally { await fixture.cleanup(); }

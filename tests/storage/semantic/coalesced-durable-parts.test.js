import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSyntaxPartitionId, canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { createSemanticPartitionSink, createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
ensureTestingEnv(process.env);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-semantic-coalesce-'));
const bytes = Buffer.from('x');
const source = createSemanticSourceSnapshot({ bytes, repositoryNamespace: 'fixture:coalesce', path: 'input.js', language: 'javascript' }).manifest;
const partitionId = createSyntaxPartitionId({ sourceUnitId: source.sourceUnitId,
  parser: { family: 'fixture', version: '1', options: {} }, extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: { structure: 'complete' } });
const row = { family: 'coverage', row: { scope: null, phase: 'syntax', state: 'complete', reason: null,
  observedCount: 1, completedCount: 1, frontierRef: null } };
const batch = (sequence, rows = [row]) => ({ partitionId, sequence, rows,
  byteCount: rows.reduce((sum, value) => sum + Buffer.byteLength(canonicalSemanticJson(value)) + 1, 0) });
const options = { stagingRoot: temporary, source, sourceBytes: bytes, partitionId,
  producerHash: 'a'.repeat(64), policyHash: 'b'.repeat(64), batchRows: 64, batchBytes: 65536 };
const account = () => createSemanticDiskAccount(8 * 1024 * 1024);
try {
  const metrics = {}; const disk = account();
  const sink = await createSemanticPartitionSink({ ...options, diskAccount: disk, metrics });
  for (let index = 0; index < 32; index += 1) await sink.appendBatch(batch(index));
  assert.equal(metrics.batchesAcknowledged, 32);
  assert.equal(metrics.partOpenCalls, 2, 'one data/offset builder replaces per-fragment opens');
  assert.equal(metrics.partSyncCalls, 64, 'each acknowledged fragment remains durable');
  assert.equal(metrics.partOffsetValidations || 0, 0, 'unfinished descriptors are not published');
  const partialDir = (await fs.readdir(temporary)).find(name => name.startsWith('semantic-part-'));
  assert.ok((await fs.readdir(path.join(temporary, partialDir))).every(name => name.endsWith('.building')));
  const descriptor = await sink.finalizeSource();
  assert.equal(descriptor.members.semantic_coverage.length, 1);
  assert.equal(descriptor.members.semantic_coverage[0].count, 32);
  assert.equal(metrics.activePartHighWater <= 8, true);
  assert.equal(metrics.partOpenCalls, 4, 'source metadata has its own bounded member builder');
  assert.equal(metrics.partOffsetValidations, 2);
  const allAtOnce = await createSemanticPartitionSink({ ...options, diskAccount: account() });
  await allAtOnce.appendBatch(batch(0, Array.from({ length: 32 }, () => row)));
  assert.equal((await allAtOnce.finalizeSource()).canonicalHash, descriptor.canonicalHash);
  const rolled = await createSemanticPartitionSink({ ...options, batchRows: 4, diskAccount: account() });
  for (let index = 0; index < 32; index += 1) await rolled.appendBatch(batch(index));
  const rollingDescriptor = await rolled.finalizeSource();
  assert.equal(rollingDescriptor.canonicalHash, descriptor.canonicalHash);
  assert.equal(rollingDescriptor.members.semantic_coverage.length, 8);

  const originalOpen = fs.open; const originalRm = fs.rm;
  let writeFault = false, removeFault = false, shortWrites = false;
  const injected = new Error('primary durable sync failure');
  fs.open = async function (filename, ...args) {
    const handle = await originalOpen.call(this, filename, ...args);
    if (!String(filename).endsWith('.building')) return handle;
    return new Proxy(handle, { get(target, key) {
      if (key === 'sync') return async () => { if (writeFault) { writeFault = false; throw injected; } return target.sync(); };
      if (key === 'write' && shortWrites) return (buffer, offset, length, position) => target.write(buffer, offset, Math.max(1, Math.floor(length / 2)), position);
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  fs.rm = async function (filename, ...args) {
    if (removeFault && path.basename(filename).startsWith('semantic-part-')) throw Object.assign(new Error('cleanup denied'), { code: 'EACCES' });
    return originalRm.call(this, filename, ...args);
  };
  try {
    const failedDisk = account(); const failed = await createSemanticPartitionSink({ ...options, diskAccount: failedDisk });
    writeFault = true; removeFault = true;
    await assert.rejects(failed.appendBatch(batch(0)), error => error === injected && error.cleanupError?.code === 'EACCES');
    assert.ok(failedDisk.used > 0, 'failed deletion retains disk authority/credit');
    removeFault = false;
    await failed.abort(); assert.equal(failedDisk.used, 0, 'retry settlement releases credit only after successful deletion');
    shortWrites = true;
    const short = await createSemanticPartitionSink({ ...options, diskAccount: account() });
    await short.appendBatch(batch(0));
    assert.equal((await short.finalizeSource()).members.semantic_coverage[0].count, 1);
  } finally { fs.open = originalOpen; fs.rm = originalRm; }
  const stop = new AbortController(); const canceledDisk = account();
  const canceled = await createSemanticPartitionSink({ ...options, diskAccount: canceledDisk, signal: stop.signal,
    scheduleIo: fn => { if (stop.signal.aborted) throw stop.signal.reason; return fn(); } });
  await canceled.appendBatch(batch(0)); stop.abort(new Error('stop staging'));
  await assert.rejects(canceled.finalizeSource(), /stop staging/);
  await canceled.abort(); assert.equal(canceledDisk.used, 0, 'abort handle close does not borrow a canceled scheduler admission');
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
console.log('coalesced semantic parts retain per-batch durability and completed-descriptor/accounting boundaries');

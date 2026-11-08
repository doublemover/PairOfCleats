import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSemanticPartitionSink, createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { createPreparedWorkInput } from '../../helpers/semantic-prepared-work.js';
import { semanticBatch } from '../../helpers/semantic-recovery.js';
import { errorGraphIncludes, errorGraphSome } from '../../helpers/error-graph.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const closeCase = selected?.match(/^(data|offset)-(false|throw|swap)$/);
assert.ok(closeCase || ['pending-write', 'pending-release', 'pending-cleanup', 'pending-release-after-error', 'null-cleanup', 'undefined-cleanup', 'false-cleanup',
  'frozen-cleanup', 'null-release', 'false-release'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir('semantic-part-original-lifetime');
const input = createPreparedWorkInput('small'), account = createSemanticDiskAccount(1024 * 1024);
const originalOpen = fs.open, originalRm = fs.rm, handles = [];
const cleanupFailure = Object.freeze(Object.assign(new Error('original cleanup refused'), { code: 'EACCES' }));
let settled = false, denyClose = true, denyRemove = selected.endsWith('-cleanup'), removals = 0, writes = 0, syncs = 0;
let replacementCloses = 0, heldHandle, closeCalls = 0, failure, failed = false;
const primary = selected.startsWith('null-') ? null : selected.startsWith('undefined-') ? undefined
  : selected.startsWith('false-') ? false : Object.freeze(new Error('original producer failure'));
const pending = Object.freeze(Object.assign(new Error('original admitted work still pending'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => settled
}));
const releaseFailure = Object.freeze(new Error('original admission release failure'));
const targeted = file => String(file).endsWith('.building');
fs.open = async (...args) => {
  const handle = await originalOpen(...args);
  if (!targeted(args[0])) return handle;
  const close = handle.close.bind(handle), write = handle.write.bind(handle), sync = handle.sync.bind(handle);
  const state = { handle, close, closed: false }; handles.push(state);
  const isOffset = String(args[0]).endsWith('.offsets.building');
  if (closeCase && (closeCase[1] === 'offset') === isOffset) {
    heldHandle = handle;
    handle.close = async () => {
      closeCalls++;
      if (denyClose) {
        if (closeCase[2] === 'swap') handle.close = async () => { replacementCloses++; };
        if (closeCase[2] === 'false') return false;
        throw primary;
      }
      await close(); state.closed = true;
    };
  } else handle.close = async () => { await close(); state.closed = true; };
  handle.write = async (...input) => {
    writes++;
    if (selected === 'pending-write') throw pending;
    if (selected.endsWith('-cleanup') || ['null-release', 'false-release', 'pending-release-after-error'].includes(selected)) throw primary;
    return write(...input);
  };
  handle.sync = async (...input) => { syncs++; return sync(...input); };
  return handle;
};
fs.rm = async (file, ...args) => {
  if (path.basename(String(file)).startsWith('semantic-part-')) {
    removals++;
    if (denyRemove) throw selected === 'pending-cleanup' ? pending : cleanupFailure;
  }
  return originalRm(file, ...args);
};
const sink = await createSemanticPartitionSink({ stagingRoot: dir, source: input.source, sourceBytes: input.bytes,
  partitionId: input.partitionId, producerHash: 'a'.repeat(64), policyHash: 'b'.repeat(64), diskAccount: account,
  batchRows: closeCase ? 1 : 64, batchBytes: 65536,
  byteAdmission: selected === 'pending-release' || selected === 'pending-release-after-error' || selected.endsWith('-release') ? { async acquire() {
    return () => { throw selected.startsWith('pending-release') ? pending : releaseFailure; };
  } } : null });
try {
  try { await sink.appendBatch(semanticBatch(input.partitionId, input.rows.slice(0, 1))); }
  catch (error) { failure = error; failed = true; }
  assert.equal(failed, true, 'failed original operations cannot become a completed part');
  if (closeCase) {
    assert.equal(closeCalls, 1, 'abort cannot retry a failed original close');
    assert.equal(replacementCloses, 0);
    assert.equal(removals, 0);
    assert.ok(account.used > 0);
    await assert.rejects(sink.abort());
    assert.equal(closeCalls, 1); assert.equal(removals, 0);
    assert.equal(observeStorageResource(failure).isSettled(), false);
    let session;
    errorGraphSome(failure, value => { session ||= getContainedFileSession(value); return false; });
    assert.ok(session, 'only the original descriptor supplies close-only recovery');
    const before = { writes, syncs, bytes: account.used };
    denyClose = false; await session.releaseAfterClose();
    assert.equal(heldHandle.fd, -1); assert.equal(closeCalls, 2); assert.equal(replacementCloses, 0);
    assert.deepEqual({ writes, syncs, bytes: account.used }, before, 'close recovery never replays writes or releases disk credits');
    await sink.abort(); assert.equal(account.used, 0);
  } else if (selected === 'pending-cleanup' || selected === 'pending-release-after-error') {
    assert.ok(errorGraphIncludes(failure, primary)); assert.ok(errorGraphIncludes(failure, pending));
    assert.equal(removals, 1); assert.ok(handles.every(state => state.closed));
    assert.equal(account.used > 0, selected === 'pending-cleanup');
    denyRemove = false;
    await assert.rejects(sink.abort()); assert.equal(removals, 1, 'retain independent cleanup/release prerequisites even after all descriptors closed');
    settled = true; await sink.abort(); assert.equal(account.used, 0);
    assert.equal(removals, selected === 'pending-cleanup' ? 2 : 1);
  } else if (selected.startsWith('pending-')) {
    assert.ok(errorGraphIncludes(failure, pending));
    assert.equal(removals, 0); assert.ok(account.used > 0);
    assert.ok(handles.every(state => !state.closed));
    await assert.rejects(sink.abort()); assert.equal(removals, 0);
    assert.ok(handles.every(state => !state.closed));
    settled = true; await sink.abort(); assert.equal(account.used, 0);
    assert.ok(handles.every(state => state.closed));
  } else {
    assert.ok(errorGraphIncludes(failure, primary), 'retain the exact falsey/frozen producer primary');
    assert.ok(errorGraphIncludes(failure, selected.endsWith('-cleanup') ? cleanupFailure : releaseFailure));
    if (denyRemove) { assert.ok(account.used > 0); denyRemove = false; await sink.abort(); }
    assert.equal(account.used, 0);
  }
  await assert.rejects(sink.finalizeSource(), error => errorGraphIncludes(error, closeCase || selected.startsWith('pending-') ? failure : primary),
    'cleanup/recovery cannot publish a failed sink');
  assert.deepEqual(await fs.readdir(dir), []);
} finally {
  fs.open = originalOpen; fs.rm = originalRm;
  for (const state of handles) if (!state.closed) { await state.close(); state.closed = true; }
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`${selected} semantic part retains original close/work and disk ownership`);

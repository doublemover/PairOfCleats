import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { createRepositoryQuestionFixture } from '../../helpers/repository-question-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { deferred } from '../../helpers/semantic-recovery.js';
import { createRetainedSourceHydrationPool } from '../../../src/context-pack/delivery/hydration.js';
import { createSourceHydrationReader } from '../../../src/context-pack/delivery/source-hydration-reader.js';
import { readRetainedSemanticSourceSnapshot } from '../../../src/semantic/retained-source-snapshot.js';
import { resolveSemanticGenerationIndexDir } from '../../../src/semantic/generation.js';
import { getRepoCacheRoot } from '../../../src/shared/repo-paths.js';
import { getContainedFileSession } from '../../../src/shared/contained-file.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('context-pack/delivery/hydration/')[1];
assert.ok(['shared-physical-read', 'scope-and-revocation', 'waiter-cancellation-and-dispose', 'native-cleanup-retention', 'work-and-waiter-bounds'].includes(mode));
const fixture = await createRepositoryQuestionFixture(), originalHome = process.env.PAIROFCLEATS_HOME;
applyTestEnv({ cacheRoot: path.join(fixture.root, 'cache'), extraEnv: { PAIROFCLEATS_HOME: path.join(fixture.root, 'home') } });
const request = { worldRef: fixture.request.question.world, partitionId: fixture.partition.partitionId,
  sourceUnitId: fixture.source.sourceUnitId, sourceHash: fixture.source.byteHash, maxBytes: 4096 };
const a = Symbol('reader-a'), b = Symbol('reader-b');
const contexts = new Map([a, b].map((token, index) => [token, { consumerId: 'reader-' + index, sessionId: 'session', contextEpoch: 0, windowRevision: 0,
  taskRef: { id: 'hydration', revision: '1' }, branchId: 'branch', scopeDigest: 'a'.repeat(64), policyDigest: 'b'.repeat(64), worldRef: request.worldRef }]));
const allowed = new Map([[a, true], [b, true]]);
const boundary = { bind: async transport => {
  const contextRef = contexts.get(transport); if (!contextRef) throw Object.assign(new Error('unbound consumer'), { code: 'ERR_CONTEXT_DELIVERY_SCOPE_DENIED' });
  return { contextRef, recheck: async () => allowed.get(transport) === true,
    authorizeSource: async (selection, { source }) => allowed.get(transport) === true && selection.sourceUnitId === fixture.source.sourceUnitId
      && (!source || source.sourceUnitId === fixture.source.sourceUnitId && source.path === 'original.js') };
} };
const captured = async promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
const create = ({ join = 2 } = {}) => {
  const gate = deferred(), entered = deferred(), resolved = deferred(); let calls = 0;
  const reader = createSourceHydrationReader({ readSnapshot: async options => {
    entered.resolve(); await gate.promise; return readRetainedSemanticSourceSnapshot(options);
  } });
  const pool = createRetainedSourceHydrationPool({ boundary, readSource: reader, resolveIndexDir: async options => {
    const value = await resolveSemanticGenerationIndexDir(options); if (++calls === join) resolved.resolve(); return value;
  } });
  return { pool, gate, entered, resolved };
};
const pools = [], open = fs.open, handles = [];
let sourceReads = 0, sourceBytes = 0;
fs.open = async (...args) => {
  const handle = await open(...args);
  if (String(args[0]).endsWith(fixture.source.byteHash + '.utf8')) {
    const read = handle.read.bind(handle); sourceReads++;
    handle.read = async (...input) => { const value = await read(...input); sourceBytes += value.bytesRead; return value; };
    handles.push({ handle, close: handle.close.bind(handle) });
  }
  return handle;
};
try {
  if (mode === 'shared-physical-read') {
    const state = create(); pools.push(state); const first = state.pool.read(request, a), second = state.pool.read(request, b);
    await state.resolved.promise; await tick(); assert.equal(state.pool.snapshot().coalescedWaiters, 1);
    state.gate.resolve(); const [left, right] = await Promise.all([first, second]);
    assert.equal(left, right); assert.equal(left.text, fixture.bytes.toString('utf8'));
    assert.equal(Object.hasOwn(left, 'bytes'), false); assert.ok(Object.isFrozen(left.source.lineStarts));
    assert.throws(() => left.source.lineStarts.push(999), TypeError);
    assert.equal(sourceReads, 1); assert.equal(sourceBytes, fixture.bytes.length, 'measure actual retained-source FileHandle bytes, not a modeled work count');
    await state.pool.read(request, a); assert.equal(sourceReads, 2, 'completed reads are not a warm path/stat authority cache');
    const file = path.join(fixture.indexDir, 'semantic', 'semantic-sources', fixture.source.byteHash + '.utf8');
    const original = await fs.readFile(file);
    try {
      await fs.writeFile(file, original.toString('utf8').replace('0', '9'));
      await assert.rejects(state.pool.read(request, a), { code: 'ERR_FILE_INTEGRITY' });
    } finally { await fs.writeFile(file, original); }
    assert.equal(state.pool.snapshot().activeEntries, 0); assert.equal(state.pool.snapshot().reservedBytes, 0);
  } else if (mode === 'scope-and-revocation') {
    contexts.get(b).scopeDigest = 'c'.repeat(64);
    const state = create(); pools.push(state);
    const first = captured(state.pool.read(request, a)), second = captured(state.pool.read(request, b));
    await state.resolved.promise; await tick(); assert.equal(state.pool.snapshot().createdReads, 2); assert.equal(state.pool.snapshot().coalescedWaiters, 0);
    allowed.set(b, false); state.gate.resolve();
    const [left, right] = await Promise.all([first, second]); assert.equal(left.ok, true); assert.equal(right.ok, false); assert.equal(right.error.reason, 'ScopeDenied');
    const before = sourceReads; await assert.rejects(state.pool.read(request, 'copied-consumer-name'), { code: 'ERR_CONTEXT_DELIVERY_SCOPE_DENIED' });
    assert.equal(sourceReads, before, 'an unbound identity cannot start or join physical source work');
    await assert.rejects(state.pool.read({ ...request, sourceUnitId: 'su1:' + '0'.repeat(64) }, a), { reason: 'ScopeDenied' });
    assert.equal(sourceReads, before, 'repository admission alone cannot authorize another source identity');
  } else if (mode === 'waiter-cancellation-and-dispose') {
    const state = create(); pools.push(state); const left = new AbortController(), right = new AbortController();
    const first = captured(state.pool.read(request, a, { signal: left.signal })), second = captured(state.pool.read(request, b, { signal: right.signal }));
    await state.resolved.promise; await state.entered.promise; await tick();
    left.abort(0); const cancelled = await first; assert.equal(cancelled.ok, false); assert.equal(cancelled.error.name, 'AbortError');
    assert.equal(state.pool.snapshot().activeEntries, 1); assert.equal(state.pool.snapshot().activeRequests, 1);
    let finished = false; second.then(() => { finished = true; }); right.abort(); await tick(); assert.equal(finished, false, 'last waiter waits for original shared work and storage cleanup');
    state.gate.resolve(); assert.equal((await second).error.name, 'AbortError');
    assert.equal(state.pool.snapshot().activeEntries, 0); assert.equal(state.pool.snapshot().reservedBytes, 0);
    const queued = create({ join: 3 }); pools.push(queued); const queuedAbort = new AbortController();
    const running = [captured(queued.pool.read(request, a)), captured(queued.pool.read({ ...request, maxBytes: 4097 }, b))];
    const waiting = captured(queued.pool.read({ ...request, maxBytes: 4098 }, a, { signal: queuedAbort.signal }));
    await queued.resolved.promise; await tick(); assert.equal(queued.pool.snapshot().queuedReads, 1);
    queuedAbort.abort(); assert.equal((await waiting).error.name, 'AbortError', 'queued cancellation does not wait for unrelated active readers');
    assert.equal(queued.pool.snapshot().occupiedReadSlots, 2);
    queued.gate.resolve(); assert.ok((await Promise.all(running)).every(result => result.ok));
    const next = create({ join: 1 }); pools.push(next); const reading = captured(next.pool.read(request, a));
    await next.entered.promise; let disposed = false;
    const disposal = next.pool.dispose().then(value => { disposed = true; return value; }); await tick(); assert.equal(disposed, false);
    next.gate.resolve(); await reading; assert.equal((await disposal).settled, true);
  } else if (mode === 'native-cleanup-retention') {
    let releaseNative = false, failClose = true;
    fs.open = async (...args) => {
      const handle = await open(...args);
      if (String(args[0]).endsWith(fixture.source.byteHash + '.utf8')) {
        const close = handle.close.bind(handle); handles.push({ handle, close });
        handle.close = async () => {
          if (failClose) { failClose = false; throw Object.assign(new Error('injected source close remains pending'), { code: 'EIO', cacheOwnershipPending: true, cacheOwnershipReleased: () => releaseNative }); }
          return close();
        };
      }
      return handle;
    };
    const state = create({ join: 1 }); pools.push(state); state.gate.resolve(); const result = await captured(state.pool.read(request, a));
    assert.equal(result.ok, false); assert.equal(result.error.cacheOwnershipReleased(), false);
    assert.ok(result.error.sharedSourceHydrationOwner); assert.equal(state.pool.snapshot().activeEntries, 1);
    assert.equal(state.pool.snapshot().occupiedReadSlots, 1, 'an unconfirmed native close retains its physical read slot');
    await assert.rejects(state.pool.drain(), error => error.sharedSourceHydrationOwner === result.error.sharedSourceHydrationOwner);
    const access = await inspectStorageAccess(getRepoCacheRoot(fixture.root), { coordinationRoot: path.join(fixture.root, 'home', 'state', 'storage-access') });
    assert.ok(access.owners.some(owner => owner.status === 'resource-settlement-unconfirmed'));
    const before = state.pool.snapshot().createdReads; await assert.rejects(state.pool.read(request, a)); assert.equal(state.pool.snapshot().createdReads, before);
    const sourceOwner = getContainedFileSession(result.error); assert.ok(sourceOwner);
    releaseNative = true; await sourceOwner.releaseAfterClose();
    const receipt = result.error.sharedSourceHydrationOwner.releaseAfterOriginalSettlement(); assert.equal(receipt.settled, true);
    assert.equal(state.pool.snapshot().activeEntries, 0); assert.equal(state.pool.snapshot().reservedBytes, 0);
    await tick(); assert.equal(state.pool.snapshot().occupiedReadSlots, 0);
  } else {
    const state = create({ join: 4 }); pools.push(state);
    const reads = Array.from({ length: 4 }, (_, index) => captured(state.pool.read({ ...request, maxBytes: 4096 + index }, a)));
    await state.resolved.promise; await tick(); assert.equal(state.pool.snapshot().activeEntries, 4);
    await assert.rejects(state.pool.read({ ...request, maxBytes: 8192 }, a), { reason: 'MandatoryOverflow' });
    state.gate.resolve(); assert.ok((await Promise.all(reads)).every(result => result.ok));
    assert.equal(state.pool.snapshot().reservedBytes, 0);
    const admissionGate = deferred(), allBound = deferred(); let bindings = 0;
    const limited = createRetainedSourceHydrationPool({ boundary: { bind: async (...args) => {
      if (++bindings === 16) allBound.resolve(); await admissionGate.promise; return boundary.bind(...args);
    } }, resolveIndexDir: async () => fixture.indexDir });
    pools.push({ pool: limited, gate: admissionGate });
    const waiters = Array.from({ length: 16 }, () => captured(limited.read(request, a)));
    await allBound.promise;
    await assert.rejects(limited.read(request, a), { reason: 'MandatoryOverflow' }); assert.equal(bindings, 16, 'waiter quota admits no seventeenth authentication/read');
    admissionGate.resolve(); assert.ok((await Promise.all(waiters)).every(result => result.ok));
    assert.equal(limited.snapshot().activeRequests, 0);
  }
} finally {
  fs.open = open;
  for (const state of pools) state.gate.resolve();
  for (const { handle, close } of handles) if (handle.fd >= 0) await close();
  for (const state of pools) await state.pool.dispose();
  if (originalHome === undefined) delete process.env.PAIROFCLEATS_HOME; else process.env.PAIROFCLEATS_HOME = originalHome;
  await fixture.cleanup();
}
console.log('Shared hydration preserves independent authorization, exact native bytes and original cleanup ownership.');

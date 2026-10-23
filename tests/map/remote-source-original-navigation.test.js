import assert from 'node:assert/strict';
import { state } from '../../src/map/isometric/client/state.js';
import { createRemoteSource } from '../../src/map/isometric/client/data/remote-source.js';
import { captureSceneResource, preserveSceneCleanupFailures } from '../../src/map/isometric/client/scene-retirement.js';

const manifest = { counts: { files: 2, members: 0, edges: 0 }, coverage: { upstreamDropped: null } };
const record = path => ({ file: { path, name: path }, entity: { type: 'file', file: path } });
const contains = (error, original, visited = new Set()) => {
  if (Object.is(error, original)) return true;
  if (!error || typeof error !== 'object' || visited.has(error)) return false;
  visited.add(error); const cause = Object.getOwnPropertyDescriptor(error, 'cause');
  return (cause && contains(cause.value, original, visited))
    || (Object.getOwnPropertyDescriptor(error, 'errors')?.value || []).some(value => contains(value, original, visited));
};
const fixture = () => {
  const calls = [], client = { request(kind, payload, options) {
    assert.equal(this, client); return new Promise((resolve, reject) => calls.push({ kind, payload, options, resolve, reject }));
  } };
  const remote = createRemoteSource({ manifest, snapshot: 'source:original', endpoint: '/unused', token: 'original' });
  Object.assign(state, { remoteSource: remote, sourceIndex: remote.index, graphWorkerReady: true, graphWorkerClient: client,
    dom: { summary: { textContent: 'original summary' } }, viewRevisions: null, cancelCameraMotion: null });
  return { remote, client, calls };
};
{
  const f = fixture(), accepted = [];
  const first = f.remote.navigate({ type: 'file', file: 'old.ts' }, value => accepted.push(value));
  const second = f.remote.navigate({ type: 'file', file: 'new.ts' }, value => accepted.push(value));
  assert.equal(f.calls[0].options.signal.aborted, true);
  f.calls[0].resolve(record('old.ts')); assert.equal((await first).reason, 'superseded');
  f.calls[1].resolve(record('new.ts')); assert.equal((await second).ok, true);
  assert.deepEqual(accepted.map(value => value.file), ['new.ts']); assert.deepEqual([...f.remote.index.files.keys()], ['new.ts']);
  f.remote.dispose(); assert.equal(f.remote.index.files.size, 0); assert.equal(f.remote.index.resolve(record('new.ts').entity), null);
}
{
  const f = fixture(); let accepted = 0, reads = 0, replacementCalls = 0;
  const operation = f.remote.navigate({ type: 'file', file: 'old.ts' }, () => { accepted++; });
  const originalSummary = state.dom.summary;
  state.remoteSource = { request() { replacementCalls++; } }; state.sourceIndex = {};
  state.dom = { summary: { textContent: 'new summary' } };
  const original = Object.freeze(Object.defineProperties({}, {
    message: { get() { reads++; throw undefined; } }, name: { get() { reads++; throw null; } }
  }));
  f.calls[0].reject(original);
  const result = await operation;
  assert.equal(result.reason, 'superseded'); assert.equal(result.primaryError, original); assert.equal(reads, 0); assert.equal(accepted, 0);
  assert.equal(originalSummary.textContent, 'original summary'); assert.equal(state.dom.summary.textContent, 'new summary');
  await assert.rejects(f.remote.request('search', {}), { name: 'AbortError' }); assert.equal(replacementCalls, 0);
  f.remote.dispose();
}
{
  const f = fixture(); let reads = 0;
  const operation = f.remote.navigate({ type: 'file', file: 'failed.ts' }, () => assert.fail('failed navigation cannot publish'));
  const primary = Object.freeze(Object.defineProperties({}, { name: { value: 'Error' }, message: { get() { reads++; throw null; } } }));
  f.calls[0].reject(primary); const result = await operation;
  assert.equal(result.primaryError, primary); assert.equal(reads, 1); assert.equal(result.inspectionErrors.includes(null), true);
  assert.match(state.dom.summary.textContent, /Source selection unavailable/);
  f.remote.dispose();
}
{
  // A failed original abort cannot be silently retried by another navigation.
  // Independent source cleanup still clears metadata and original page owners.
  const f = fixture(), OriginalController = globalThis.AbortController;
  const abortFailure = Object.freeze(new Error('original navigation abort failed'));
  let failAbort = true, aborts = 0;
  globalThis.AbortController = class extends OriginalController {
    abort(...args) { aborts++; super.abort(...args); if (failAbort) throw abortFailure; }
  };
  try {
    const first = f.remote.navigate({ type: 'file', file: 'old.ts' }, () => assert.fail('old request must be stale'));
    const rejected = await f.remote.navigate({ type: 'file', file: 'replacement.ts' }, () => assert.fail('failed original abort cannot admit replacement'));
    assert.equal(contains(rejected.error, abortFailure), true); assert.equal(f.calls.length, 1); assert.equal(aborts, 1);
    await f.remote.navigate({ type: 'file', file: 'another.ts' }, () => assert.fail('native failed abort must not be retried automatically'));
    assert.equal(aborts, 1); assert.equal(f.calls.length, 1);
    assert.throws(() => f.remote.dispose(), error => contains(error, abortFailure));
    assert.equal(f.remote.index.files.size, 0);
    const owner = f.remote.pendingOwners.find(value => value.label === 'original remote navigation abort');
    assert.ok(owner); failAbort = false; owner.release(); assert.equal(aborts, 2);
    f.remote.resourceOwner.release();
    f.calls[0].resolve(record('old.ts')); assert.equal((await first).reason, 'superseded');
  } finally { globalThis.AbortController = OriginalController; }
}
{
  const f = fixture(); let sourceReleased = false, cacheReleased = false, childFailed = true, childCloses = 0;
  const unknown = Object.freeze(Object.defineProperties(new Error('independent pending source work'), {
    sceneOwnershipReleased: { value: () => sourceReleased }, cacheOwnershipReleased: { value: () => cacheReleased },
    sceneResourceOwner: { value: { release() { assert.fail('a lookalike cannot provide original source closure'); } } }
  }));
  const child = captureSceneResource({ dispose() { childCloses++; if (childFailed) throw new Error('independent original child'); } }, 'independent original source child');
  let childFailure; try { child.retire(); } catch (error) { childFailure = error; }
  const mixed = preserveSceneCleanupFailures(childFailure, [unknown], { hasPrimary: true, forceAggregate: true });
  const operation = f.remote.navigate({ type: 'file', file: 'pending.ts' }, () => assert.fail('pending request cannot publish'));
  f.calls[0].reject(mixed); assert.equal((await operation).ok, false);
  assert.throws(() => f.remote.dispose());
  const navigation = f.remote.pendingOwners.find(owner => owner.label === 'original remote navigation abort');
  assert.ok(navigation); assert.equal(f.calls[0].options.signal.aborted, false);
  sourceReleased = true; childFailed = false; child.release(); assert.equal(childCloses, 2);
  assert.throws(() => f.remote.resourceOwner.release()); assert.equal(f.calls[0].options.signal.aborted, false);
  cacheReleased = true; f.remote.resourceOwner.release(); assert.equal(f.calls[0].options.signal.aborted, true);
  assert.equal(navigation.pending, false); assert.equal(f.remote.resourceOwner.pending, false);
}
{
  const f = fixture(), primary = Object.freeze(new Error('original navigation failure'));
  state.dom.summary = Object.defineProperty({}, 'textContent', { set() { throw undefined; } });
  const operation = f.remote.navigate({ type: 'file', file: 'failed-report.ts' }, () => assert.fail('failed request cannot publish'));
  f.calls[0].reject(primary); const result = await operation;
  assert.equal(result.primaryError, primary); assert.equal(contains(result.error, primary), true); assert.equal(contains(result.error, undefined), true);
  f.remote.dispose();
}
{
  const f = fixture(); let entered = false;
  state.viewRevisions = { bump() { entered = true; f.remote.dispose(); } };
  const result = await f.remote.navigate({ type: 'file', file: 'reentrant.ts' }, () => assert.fail('retirement cannot resurrect selection'));
  assert.equal(entered, true); assert.equal(result.reason, 'superseded'); assert.equal(f.calls.length, 0);
  assert.equal(f.remote.resourceOwner.pending, true); f.remote.resourceOwner.release();
  assert.equal(f.remote.resourceOwner.pending, false);
}
console.log('Original remote source publication, selection callbacks and independent retirement controls passed.');

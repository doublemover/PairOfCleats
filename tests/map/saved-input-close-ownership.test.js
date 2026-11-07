import assert from 'node:assert/strict';
import { MAP_MODEL_VERSION } from '../../src/map/constants.js';
import { readSavedMap } from '../../tools/analysis/map-saved-input.js';

const bytes = Buffer.from(JSON.stringify({ version: MAP_MODEL_VERSION, root: { id: 'close-fixture' }, nodes: [], edges: [] }));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const fixture = ({ raw = bytes, closeErrors = [], readError = null, signal = null, onCurrent = null, closeGate = null } = {}) => {
  const snapshot = { dev: 1n, ino: 2n, size: BigInt(raw.length), mtimeNs: 3n, ctimeNs: 4n, isFile: () => true };
  const state = { opened: 0, closes: 0, closed: false, closeGate, closeEntered: deferred() };
  const handle = { fd: 23,
    async stat() { return snapshot; },
    async *createReadStream() { if (readError) throw readError; yield raw; },
    async close() {
      assert.equal(this, handle, 'only the originally acquired handle may seed resource closure');
      const index = state.closes++;
      state.closeEntered.resolve();
      if (state.closeGate) await state.closeGate.promise;
      if (index < closeErrors.length) throw closeErrors[index];
      state.closed = true;
    }
  };
  const fsImpl = { async open() { state.opened++; return handle; }, async stat() { onCurrent?.(); return snapshot; },
    async close() { throw new Error('Raw fd/path closure is never authorized.'); } };
  return { state, handle, read: () => readSavedMap('original-path.json', { fsImpl, signal }) };
};
const thrown = async action => { try { await action(); } catch(error) { return error; } throw new Error('Expected actual admission/close failure.'); };

const nativeClose = Object.freeze(Object.assign(new Error('controlled close rejection'), { code: 'ECLOSE' }));
const successfulAdmission = fixture({ closeErrors: [nativeClose] });
const closeFailure = await thrown(successfulAdmission.read);
assert.equal(closeFailure.code, 'ERR_MAP_SAVED_HANDLE_CLOSE'); assert.equal(closeFailure.primaryError, null);
assert.deepEqual(closeFailure.errors, [nativeClose]); assert.equal(closeFailure.cause, nativeClose);
assert.equal(closeFailure.cleanupErrors[0], nativeClose); assert.equal(closeFailure.mapSavedHandle.lastError, nativeClose);
assert.equal(closeFailure.cacheOwnershipPending, true); assert.equal(closeFailure.cacheOwnershipReleased(), false);
assert.equal(successfulAdmission.state.closed, false, 'an admitted model is not published when descriptor closure is unconfirmed');
successfulAdmission.handle.fd = 9999;
successfulAdmission.handle.close = () => { throw new Error('Replacement close method cannot acquire original descriptor authority.'); };
successfulAdmission.state.closeGate = deferred();
const first = closeFailure.mapSavedHandle.close(), second = closeFailure.mapSavedHandle.close();
assert.equal(first, second, 'reconciliation coalesces one original-handle close flight');
await Promise.resolve(); assert.equal(closeFailure.cacheOwnershipPending, true);
successfulAdmission.state.closeGate.resolve();
assert.deepEqual(await first, { settled: true, pending: false });
assert.equal(closeFailure.cacheOwnershipReleased(), true); assert.equal(closeFailure.cacheOwnershipPending, false);
await closeFailure.mapSavedHandle.close(); assert.equal(successfulAdmission.state.closes, 2);
assert.equal(successfulAdmission.state.opened, 1, 'reconciliation cannot reopen a replaced path');
assert.equal(closeFailure.cleanupErrors[0], nativeClose, 'successful reconciliation retains the actual earlier close failure');
const laterClose = new Error('second exact close rejection'), repeated = fixture({ closeErrors: [nativeClose, laterClose] });
const repeatedFailure = await thrown(repeated.read);
assert.equal(await thrown(() => repeatedFailure.mapSavedHandle.close()), laterClose);
assert.equal(repeatedFailure.mapSavedHandle.lastError, laterClose); assert.equal(repeatedFailure.cacheOwnershipPending, true);
await repeatedFailure.mapSavedHandle.close(); assert.equal(repeatedFailure.cacheOwnershipReleased(), true);
assert.equal(repeatedFailure.cleanupErrors[0], nativeClose);

const primary = Object.freeze(Object.assign(new Error('controlled read failure'), { code: 'EREAD' }));
const both = fixture({ readError: primary, closeErrors: [nativeClose] }), admissionFailure = await thrown(both.read);
assert.equal(admissionFailure.cause, primary); assert.equal(admissionFailure.primaryError, primary);
assert.deepEqual(admissionFailure.errors, [primary, nativeClose]); assert.equal(admissionFailure.code, 'EREAD');
assert.match(admissionFailure.message, /controlled read failure.*controlled close rejection/);
await admissionFailure.mapSavedHandle.close();
const ordinaryReadFailure = fixture({ readError: primary });
assert.equal(await thrown(ordinaryReadFailure.read), primary, 'successful cleanup leaves the exact original primary failure intact');
const malformed = fixture({ raw: Buffer.from('{'), closeErrors: [nativeClose] }), parseFailure = await thrown(malformed.read);
assert.equal(parseFailure.cause.name, 'SyntaxError'); assert.equal(parseFailure.name, 'SyntaxError');
assert.equal(parseFailure.errors[1], nativeClose); await parseFailure.mapSavedHandle.close();

const abort = Object.freeze(Object.assign(new Error('controlled cancellation'), { name: 'AbortError', code: 'ABORT_ERR' }));
const controller = new AbortController(), cancelled = fixture({ signal: controller.signal,
  onCurrent: () => controller.abort(abort), closeErrors: [nativeClose] });
const cancelledFailure = await thrown(cancelled.read);
assert.equal(cancelledFailure.cause, abort); assert.equal(cancelledFailure.name, 'AbortError'); assert.equal(cancelledFailure.code, 'ABORT_ERR');
assert.equal(cancelledFailure.errors[1], nativeClose); assert.equal(cancelledFailure.cacheOwnershipPending, true);
await cancelledFailure.mapSavedHandle.close(); assert.equal(cancelledFailure.cacheOwnershipReleased(), true);
const delayedAbort = new AbortController(), delayedGate = deferred(), closing = fixture({ signal: delayedAbort.signal, closeGate: delayedGate });
let closeSettled = false;
const closingRead = closing.read(); closingRead.then(() => { closeSettled = true; }, () => { closeSettled = true; });
await closing.state.closeEntered.promise; delayedAbort.abort(abort);
await Promise.resolve(); assert.equal(closeSettled, false, 'cancellation waits for its exact still-pending close call');
delayedGate.resolve(); assert.equal(await thrown(() => closingRead), abort); assert.equal(closing.state.closed, true);
const rejectedAbort = new AbortController(), rejectedGate = deferred(), rejectingClose = fixture({ signal: rejectedAbort.signal,
  closeGate: rejectedGate, closeErrors: [nativeClose] });
const rejectingRead = rejectingClose.read(); rejectingRead.catch(() => {});
await rejectingClose.state.closeEntered.promise; rejectedAbort.abort(abort); rejectedGate.resolve();
const lateAbortFailure = await thrown(() => rejectingRead);
assert.equal(lateAbortFailure.cause, abort); assert.deepEqual(lateAbortFailure.errors, [abort, nativeClose]);
await lateAbortFailure.mapSavedHandle.close();

let nestedReleased = false;
const nested = new Error('another original resource remains pending');
const originalResource = Object.freeze({ exact: 'original-resource-capability' });
Object.defineProperties(nested, { originalResource: { value: originalResource }, cacheOwnershipPending: { value: true },
  cacheOwnershipReleased: { value: function() { return this === nested && nestedReleased; } } });
Object.freeze(nested);
const nestedFixture = fixture({ readError: nested, closeErrors: [nativeClose] }), nestedFailure = await thrown(nestedFixture.read);
await nestedFailure.mapSavedHandle.close();
assert.equal(nestedFailure.mapSavedHandle.closed, true); assert.equal(nestedFailure.cacheOwnershipPending, true,
  'file closure cannot erase an unrelated pending owner carried by the primary cause');
nestedReleased = true; assert.equal(nestedFailure.cacheOwnershipReleased(), true);
assert.equal(nestedFailure.primaryError, nested);
assert.equal(nestedFailure.originalResource, originalResource, 'non-enumerable original resource capabilities survive aggregation without getter execution');
console.log('Saved map exact-handle close rejection, primary preservation, coalesced reconciliation and pending ownership assertions complete; unvalidated');

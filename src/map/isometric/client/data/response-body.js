import { captureSceneResource, preserveSceneCleanupFailures } from '../scene-retirement.js';
import { createSceneWorkPrerequisites } from '../scene-work-prerequisites.js';
import { captureSceneFailure } from '../scene-failure-inspection.js';

const typed = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typed, 'byteLength').get;
const kind = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag).get;
const set = Uint8Array.prototype.set;

/** Shared actual workspace/snapshot body reader. Parsing is part of admission,
 * before independent original cancellation and lock-release outcomes settle. */
export const readMapJsonBody = async (response, { signal = null, maxBytes, budgetMessage,
  assertResponse = () => {}, assertValue = () => {} } = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Invalid bounded map response admission.');
  const body = response.body, getReader = body?.getReader;
  if (typeof getReader !== 'function') throw new TypeError('Map transport requires a readable response body.');
  const reader = Reflect.apply(getReader, body, []);
  let reading = true, primary, hasPrimary = false, value;
  const originalWork = Object.freeze(Object.defineProperty(new Error('Original map body admission has not returned.'),
    'sceneOwnershipReleased', { value: () => !reading }));
  const cancellation = captureSceneResource(reader, 'original map response cancellation', 'cancel', [], { required: true });
  const lock = captureSceneResource(reader, 'original map response lock', 'releaseLock', [], { required: true });
  const work = createSceneWorkPrerequisites('Original map response work remains pending.', [cancellation, lock]);
  work.attach(cancellation); work.attach(lock); work.retain(originalWork);
  try {
    cancellation.assertCaptured(); lock.assertCaptured();
    const read = reader.read;
    if (typeof read !== 'function') throw new TypeError('Map transport requires an original reader method.');
    signal?.throwIfAborted();
    assertResponse(response);
    const chunks = []; let bytes = 0;
    for (;;) {
      signal?.throwIfAborted();
      const result = await Reflect.apply(read, reader, []);
      signal?.throwIfAborted();
      if (result.done) break;
      const chunk = result.value;
      if (Reflect.apply(kind, chunk, []) !== 'Uint8Array') throw new TypeError('Map transport requires byte chunks.');
      const size = Reflect.apply(byteLength, chunk, []);
      if (size > maxBytes - bytes) throw new RangeError(budgetMessage || 'Map response exceeds its byte budget.');
      const copy = new Uint8Array(size); Reflect.apply(set, copy, [chunk]);
      chunks.push(copy); bytes += size;
    }
    const joined = new Uint8Array(bytes); let at = 0;
    for (const chunk of chunks) { Reflect.apply(set, joined, [chunk, at]); at += chunk.byteLength; }
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
    assertValue(value, response); signal?.throwIfAborted();
  } catch (error) { primary = error; hasPrimary = true; work.retain(error); }
  finally { reading = false; }
  const errors = [];
  for (const owner of [cancellation, lock]) {
    try { await owner.retireAsync(); }
    catch (error) { errors.push(error); work.retain(error); }
  }
  if (!hasPrimary && signal?.aborted) {
    try { signal.throwIfAborted(); } catch (error) { primary = error; hasPrimary = true; }
  }
  const failure = preserveSceneCleanupFailures(primary, errors, { hasPrimary, forceAggregate: hasPrimary && errors.length > 0 });
  if (hasPrimary && !errors.length && !captureSceneFailure(primary).inspectionErrors.length && !captureSceneFailure(primary).overflow) throw primary;
  if (failure) throw failure;
  return value;
};

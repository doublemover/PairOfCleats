import fs from 'node:fs/promises';
import { captureSceneResource, preserveSceneCleanupFailures } from '../../src/map/isometric/client/scene-retirement.js';
import { captureSceneFailure } from '../../src/map/isometric/client/scene-failure-inspection.js';

export const MAP_VIEWER_ASSET_BYTES = 8 * 1024 * 1024;
const outcomes = new WeakMap();
const sameSnapshot = (left, right) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);

/** One bounded original descriptor; a failed close is never an optional miss. */
export const readMapViewerAsset = async (filePath, { signal = null, fsImpl = fs } = {}) => {
  signal?.throwIfAborted();
  const handle = await fsImpl.open(filePath, 'r');
  const owner = captureSceneResource(handle, 'original pinned viewer asset descriptor', 'close', [], { required: true });
  let reading = true, bytes, primary, hasPrimary = false;
  const originalWork = Object.freeze(Object.defineProperty(new Error('Original viewer asset read has not returned.'),
    'sceneOwnershipReleased', { value: () => !reading }));
  owner.retainFailure(originalWork);
  try {
    owner.assertCaptured();
    const originalStat = handle.stat, originalStream = handle.createReadStream, originalCurrentStat = fsImpl.stat;
    if ([originalStat, originalStream, originalCurrentStat].some(method => typeof method !== 'function')) throw new TypeError('Viewer asset admission requires original descriptor and source methods.');
    const before = await Reflect.apply(originalStat, handle, [{ bigint: true }]);
    if (!before.isFile() || before.size > BigInt(MAP_VIEWER_ASSET_BYTES)) throw new Error('Asset is not a bounded regular file.');
    signal?.throwIfAborted();
    const chunks = []; let size = 0;
    for await (const chunk of Reflect.apply(originalStream, handle, [{ autoClose: false, signal }])) {
      signal?.throwIfAborted();
      size += chunk.length;
      if (size > MAP_VIEWER_ASSET_BYTES) throw new Error('Asset exceeded its admission budget while reading.');
      chunks.push(Buffer.from(chunk));
    }
    const after = await Reflect.apply(originalStat, handle, [{ bigint: true }]),
      current = await Reflect.apply(originalCurrentStat, fsImpl, [filePath, { bigint: true }]);
    signal?.throwIfAborted();
    if (BigInt(size) !== before.size || !sameSnapshot(before, after) || !sameSnapshot(after, current)) {
      throw new Error('Viewer asset changed or was replaced during admission. Restart from a stable local checkout.');
    }
    bytes = Buffer.concat(chunks, size);
  } catch (error) { primary = error; hasPrimary = true; owner.retainFailure(error); }
  finally { reading = false; }
  let cleanup, cleanupFailed = false;
  try { await owner.retireAsync(); }
  catch (error) { cleanup = error; cleanupFailed = true; }
  if (!hasPrimary && signal?.aborted) {
    try { signal.throwIfAborted(); } catch (error) { primary = error; hasPrimary = true; }
  }
  if (cleanupFailed) {
    const failure = preserveSceneCleanupFailures(primary, [cleanup], { hasPrimary, forceAggregate: true });
    outcomes.set(failure, Object.freeze({ cleanupFailed: true, owner }));
    throw failure;
  }
  if (hasPrimary) throw primary;
  signal?.throwIfAborted();
  return bytes;
};

/** Only this reader's producer record or an original observer can block an
 * optional downgrade. Public lookalike owner fields grant no closure authority. */
export const assertOptionalMapAssetFailure = error => {
  const captured = captureSceneFailure(error);
  if (outcomes.has(error) || captured.name === 'AbortError' || captured.code === 'ABORT_ERR'
    || captured.hasOwnership || captured.inspectionErrors.length || captured.overflow) {
    throw preserveSceneCleanupFailures(error, [], { hasPrimary: true, forceAggregate: true });
  }
};

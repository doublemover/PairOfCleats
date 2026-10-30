import path from 'node:path';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { createWasmSourceSnapshot } from '../index/semantic/source.js';
import { WASM_LIMITS } from '../index/semantic/wasm/decode.js';
import { readVerifiedContainedFile } from '../shared/contained-file.js';
import { throwIfAborted } from '../shared/abort.js';
import { addStorageFailureContext } from '../shared/storage/operation-error.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });

/** Own caller metadata before any awaited partition or descriptor operation. */
export const snapshotRetainedWasmSourceManifest = value => {
  const source = assertSemanticEnvelope('source', JSON.parse(canonicalSemanticJson(value, { maxBytes: 65536 })));
  if (source.encoding !== 'binary' || source.coordinateUnit !== 'byte' || source.language !== 'wasm'
    || source.decoding !== 'wasm-binary-v1' || source.textLength !== 0 || source.dialect !== null
    || source.mapping !== null || source.lineStarts.length !== 1 || source.lineStarts[0] !== 0) {
    throw fail('Retained WASM source coordinates are unavailable.');
  }
  Object.freeze(source.lineStarts);
  return Object.freeze(source);
};

/** Capture a pinned binary source through its original contained descriptor.
 * Decoding callers receive only the bytes whose EOF/hash/identity/close settled.
 * The surrounding task/compiler owner retains its existing generation lease.
 */
export const readRetainedWasmSourceSnapshot = async ({ store, partitionId, source = null, signal = null }) => {
  const expected = source === null ? null : snapshotRetainedWasmSourceManifest(source);
  const root = store?.storeId;
  if (store?.backend !== 'artifact' || typeof root !== 'string') throw new TypeError('Pinned retained artifact source required.');
  throwIfAborted(signal);
  let retained = null;
  for await (const row of store.iterateRows(partitionId, 'semantic_sources', { signal, batchRows: 1 })) {
    if (retained) throw fail('Multiple retained WASM source manifests.');
    retained = snapshotRetainedWasmSourceManifest(row);
  }
  if (!retained || expected && canonicalSemanticJson(retained) !== canonicalSemanticJson(expected)) {
    throw fail('Retained WASM manifest differs from its pinned source authority.');
  }
  if (retained.byteLength > WASM_LIMITS.bytes) {
    throw Object.assign(new RangeError('Retained WASM source exceeds its decoder byte allowance.'), { code: 'ERR_FILE_TOO_LARGE' });
  }
  try {
    const { buffer: bytes } = await readVerifiedContainedFile(root,
      path.join(root, 'semantic-sources', retained.byteHash + '.utf8'), {
        maxBytes: WASM_LIMITS.bytes, expectedBytes: retained.byteLength, expectedHash: retained.byteHash, signal
      });
    const captured = snapshotRetainedWasmSourceManifest(createWasmSourceSnapshot({ bytes,
      repositoryNamespace: retained.repositoryNamespace, path: retained.path }));
    if (canonicalSemanticJson(captured) !== canonicalSemanticJson(retained)) throw fail('Retained WASM source differs from its captured bytes.');
    throwIfAborted(signal);
    return { bytes, source: captured };
  } catch (error) {
    throw addStorageFailureContext(error, { sourceUnitId: retained.sourceUnitId, sourcePath: retained.path,
      partitionId, operation: 'read-retained-wasm-source' });
  }
};

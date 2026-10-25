import path from 'node:path';
import { readRetainedWasmSourceSnapshot, snapshotRetainedWasmSourceManifest } from '../../../semantic/retained-wasm-source-snapshot.js';
import { WASM_LIMITS } from './decode.js';
/** Consumers read the admitted generation, never a new working-tree snapshot. */
export const retainedWasmSource = ({ source, root, store, syntaxPartitionId }) => {
  const pinned = snapshotRetainedWasmSourceManifest(source);
  if (typeof store?.storeId !== 'string' || path.relative(path.resolve(root), path.resolve(store.storeId)) !== '') {
    throw new TypeError('Retained WASM source root differs from its artifact owner.');
  }
  return Object.freeze({
    source: pinned, moduleRef: Object.freeze({ partitionId: syntaxPartitionId, localId: 0 }),
    async readBytes(signal) {
      if (pinned.byteLength > WASM_LIMITS.bytes) return null;
      return (await readRetainedWasmSourceSnapshot({ store, partitionId: syntaxPartitionId, source: pinned, signal })).bytes;
    }
  });
};

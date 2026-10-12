import fs from 'node:fs/promises';
import { resolveSemanticPartPath } from '../../../semantic/artifact-store.js';
import { WASM_LIMITS } from './decode.js';
/** Consumers read the admitted generation, never a new working-tree snapshot. */
export const retainedWasmSource = ({ source, root, store, syntaxPartitionId }) => ({
  source, moduleRef: { partitionId: syntaxPartitionId, localId: 0 },
  async readBytes(signal) {
    if (source.byteLength > WASM_LIMITS.bytes) return null;
    await store.verifySource(source, { signal });
    return fs.readFile(await resolveSemanticPartPath(root, 'semantic-sources/' + source.byteHash + '.utf8'));
  }
});

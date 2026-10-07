import { loadMinhashSignatures } from '../../shared/artifact-io/loaders/minhash.js';
import { MAX_JSON_BYTES } from '../../shared/artifact-io/constants.js';

/** Load the common artifact representation and retain its sampling descriptor. */
export const loadLmdbMinhashArtifact = async (dir) => {
  const payload = await loadMinhashSignatures(dir, { maxBytes: MAX_JSON_BYTES, strict: false });
  if (!payload) return null;
  return {
    ...payload,
    // The existing msgpack codec encodes Uint32Array as byte buffers. Keep the
    // established numeric-array representation instead of losing high bits.
    signatures: payload.signatures.map((row) => ArrayBuffer.isView(row) ? Array.from(row) : row)
  };
};

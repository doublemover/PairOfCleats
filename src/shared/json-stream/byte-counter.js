import crypto from 'node:crypto';
import { Transform } from 'node:stream';

/**
 * Build transform that counts bytes and optional checksum while enforcing cap.
 *
 * @param {number|null} maxBytes
 * @param {number|null} highWaterMark
 * @param {string|null} [checksumAlgo]
 * @returns {{counter:Transform,getBytes:()=>number,isOverLimit:()=>boolean,checksumAlgo:string|null,getChecksum:()=>string|null}}
 */
export const createByteCounter = (maxBytes, highWaterMark, checksumAlgo = null) => {
  let bytes = 0;
  let overLimit = false;
  const resolvedChecksumAlgo = typeof checksumAlgo === 'string' && checksumAlgo.trim()
    ? checksumAlgo.trim().toLowerCase()
    : null;
  const checksumHash = resolvedChecksumAlgo ? crypto.createHash(resolvedChecksumAlgo) : null;
  let checksumValue = null;
  const counter = new Transform({
    ...(highWaterMark ? { highWaterMark } : {}),
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (Number.isFinite(Number(maxBytes)) && maxBytes > 0 && bytes > maxBytes) {
        overLimit = true;
        callback(new Error(`JSON stream exceeded maxBytes (${bytes} > ${maxBytes}).`));
        return;
      }
      if (checksumHash) {
        checksumHash.update(chunk);
      }
      callback(null, chunk);
    }
  });
  return {
    counter,
    getBytes: () => bytes,
    isOverLimit: () => overLimit,
    checksumAlgo: resolvedChecksumAlgo,
    getChecksum: () => {
      if (!checksumHash) return null;
      if (checksumValue == null) {
        checksumValue = checksumHash.digest('hex');
      }
      return checksumValue;
    }
  };
};

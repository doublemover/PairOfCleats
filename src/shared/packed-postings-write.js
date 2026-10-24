import { createHash } from 'node:crypto';
import { atomicWriteChunks } from './io/atomic-write.js';
import { throwIfAborted } from './abort.js';
import { createCooperativeYielder } from './json-stream/runtime.js';
import { iteratePackedTfPostings, DEFAULT_PACKED_BLOCK_SIZE } from './packed-postings.js';

/** Stream the unchanged packed format and bounded offsets through durable writes. */
export const writePackedTfPostings = async (dataPath, offsetsPath, lists, {
  blockSize = DEFAULT_PACKED_BLOCK_SIZE,
  signal = null
} = {}) => {
  const dataHash = createHash('sha256'), offsetsHash = createHash('sha256');
  const cooperate = createCooperativeYielder();
  let dataBytes = 0, offsetBytes = 0;
  let offsets = Buffer.allocUnsafe(64 * 1024), offsetUsed = 0;
  const ready = [];
  const onOffset = (_index, value) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Packed postings offset exceeds safe integer range.');
    offsets.writeBigUInt64LE(BigInt(value), offsetUsed);
    offsetUsed += 8;
    if (offsetUsed === offsets.length) {
      ready.push(offsets);
      offsets = Buffer.allocUnsafe(64 * 1024);
      offsetUsed = 0;
    }
  };
  // The outer staging handle stays private while data is encoded/published.
  // Offsets publish only after data is durable, preserving existing ordering.
  await atomicWriteChunks(offsetsPath, async (writeOffsets) => {
    const flushOffsets = async () => {
      for (const block of ready) {
        await writeOffsets(block);
        offsetsHash.update(block);
        offsetBytes += block.length;
      }
      ready.length = 0;
    };
    await atomicWriteChunks(dataPath, async (writeData) => {
      for (const block of iteratePackedTfPostings(lists, { blockSize, onOffset })) {
        throwIfAborted(signal);
        await writeData(block);
        dataHash.update(block);
        dataBytes += block.length;
        await flushOffsets();
        const pending = cooperate();
        if (pending) await pending;
      }
      await flushOffsets();
      if (offsetUsed) {
        const tail = offsets.subarray(0, offsetUsed);
        await writeOffsets(tail);
        offsetsHash.update(tail);
        offsetBytes += tail.length;
      }
    }, { signal });
  }, { signal });
  return {
    blockSize,
    data: { bytes: dataBytes, checksumHash: `sha256:${dataHash.digest('hex')}` },
    offsets: { bytes: offsetBytes, checksumHash: `sha256:${offsetsHash.digest('hex')}` }
  };
};

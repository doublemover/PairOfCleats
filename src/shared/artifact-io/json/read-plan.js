export const SMALL_JSONL_BYTES = 128 * 1024;
const MEDIUM_JSONL_BYTES = 8 * 1024 * 1024;
const JSONL_HIGH_WATERMARK_SMALL = 64 * 1024;
const JSONL_HIGH_WATERMARK_MEDIUM = 256 * 1024;
const JSONL_HIGH_WATERMARK_LARGE = 1024 * 1024;

/**
 * Choose stream chunk sizes based on compressed/plain JSONL file size.
 *
 * @param {number} byteSize
 * @returns {{highWaterMark:number,chunkSize:number,smallFile:boolean}}
 */
export const resolveJsonlReadPlan = (byteSize) => {
  if (byteSize <= SMALL_JSONL_BYTES) {
    return {
      highWaterMark: JSONL_HIGH_WATERMARK_SMALL,
      chunkSize: JSONL_HIGH_WATERMARK_SMALL,
      smallFile: true
    };
  }
  if (byteSize <= MEDIUM_JSONL_BYTES) {
    return {
      highWaterMark: JSONL_HIGH_WATERMARK_MEDIUM,
      chunkSize: JSONL_HIGH_WATERMARK_MEDIUM,
      smallFile: false
    };
  }
  return {
    highWaterMark: JSONL_HIGH_WATERMARK_LARGE,
    chunkSize: JSONL_HIGH_WATERMARK_LARGE,
    smallFile: false
  };
};

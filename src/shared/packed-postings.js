const MAX_VARINT_BYTES = 10;
const DEFAULT_BLOCK_SIZE = 128;
const MAX_SAFE_OFFSET = BigInt(Number.MAX_SAFE_INTEGER);
const invalidPackedValue = message => Object.assign(new Error(message), { code: 'ERR_VARINT_DECODE' });

const decodeVarint = (buffer, offset) => {
  let result = 0;
  let shift = 0;
  let index = offset;
  while (index < buffer.length && index - offset < MAX_VARINT_BYTES) {
    const byte = buffer[index];
    // Bitwise shifts truncate to signed 32-bit values. Packed IDs/frequencies
    // use the nonnegative safe-integer Number domain, including wider varints.
    result += (byte & 0x7f) * (2 ** shift);
    if (!Number.isSafeInteger(result)) throw invalidPackedValue('Packed varint exceeds Number.MAX_SAFE_INTEGER.');
    index += 1;
    if ((byte & 0x80) === 0) {
      return { value: result, offset: index };
    }
    shift += 7;
  }
  throw invalidPackedValue('Invalid or truncated packed varint sequence.');
};

/**
 * Encode directly into bounded slabs. Each yielded slab is exclusively owned
 * and offsets are reported in wire order, including the terminal offset.
 */
export function* iteratePackedTfPostings(postingsList, {
  blockSize = DEFAULT_BLOCK_SIZE,
  onOffset = null
} = {}) {
  const lists = Array.isArray(postingsList) ? postingsList : [];
  const slabBytes = 64 * 1024;
  let slab = Buffer.allocUnsafe(slabBytes), used = 0, total = 0;
  const append = (value) => {
    let num = Number(value);
    if (!Number.isFinite(num) || num < 0) num = 0;
    num = Math.floor(num);
    do {
      const more = num >= 0x80;
      slab[used++] = more ? (num & 0x7f) | 0x80 : num;
      num = Math.floor(num / 128);
    } while (num > 0);
  };
  const take = () => {
    const result = slab.subarray(0, used);
    total += used;
    slab = Buffer.allocUnsafe(slabBytes);
    used = 0;
    return result;
  };
  for (let listIndex = 0; listIndex < lists.length; listIndex += 1) {
    onOffset?.(listIndex, total + used);
    const list = Array.isArray(lists[listIndex]) ? lists[listIndex] : [];
    if (used > slabBytes - MAX_VARINT_BYTES) yield take();
    append(list.length);
    let previous = 0;
    for (let index = 0; index < list.length; index += 1) {
      if (index % blockSize === 0) previous = 0;
      const entry = list[index] || [];
      const docId = Number(entry[0]) || 0;
      const tf = Number(entry[1]) || 0;
      // Numbers can exceed 64-bit values in legacy callers; reserve enough for
      // the complete finite Number varint rather than silently truncating it.
      if (used > slabBytes - 320) yield take();
      append(Math.max(0, Math.floor(docId - previous)));
      append(tf);
      previous = docId;
    }
  }
  onOffset?.(lists.length, total + used);
  if (used) yield slab.subarray(0, used);
}

const decodeTfPostingList = (buffer, blockSize) => {
  let cursor = 0;
  const { value: count, offset } = decodeVarint(buffer, cursor);
  cursor = offset;
  // Each admitted pair needs at least one delta byte and one frequency byte.
  // Refuse impossible cardinality before allocating from an untrusted count.
  if (count > Math.floor((buffer.length - cursor) / 2)) {
    throw invalidPackedValue('Packed posting count exceeds the available pair bytes.');
  }
  const list = new Array(count);
  let prevDoc = 0;
  for (let i = 0; i < count; i += 1) {
    if (i % blockSize === 0) prevDoc = 0;
    const deltaResult = decodeVarint(buffer, cursor);
    cursor = deltaResult.offset;
    const tfResult = decodeVarint(buffer, cursor);
    cursor = tfResult.offset;
    const docId = prevDoc + deltaResult.value;
    if (!Number.isSafeInteger(docId)) throw invalidPackedValue('Packed posting document ID exceeds Number.MAX_SAFE_INTEGER.');
    prevDoc = docId;
    list[i] = [docId, tfResult.value];
  }
  if (cursor !== buffer.length) throw invalidPackedValue('Packed posting row contains trailing bytes.');
  return list;
};

/**
 * Decode a single packed posting list slice.
 * @param {Buffer} buffer
 * @param {{blockSize?:number}} [options]
 * @returns {Array<[number, number]>}
 */
export const unpackTfPostingSlice = (buffer, { blockSize = DEFAULT_BLOCK_SIZE } = {}) => {
  if (!buffer || buffer.length === 0) return [];
  return decodeTfPostingList(buffer, blockSize);
};

/**
 * Encode an offsets array as little-endian uint64 values.
 * @param {number[]} offsets
 * @returns {Buffer}
 */
export const encodePackedOffsets = (offsets) => {
  const buffer = Buffer.alloc(offsets.length * 8);
  for (let i = 0; i < offsets.length; i += 1) {
    const value = offsets[i];
    const safe = Number.isFinite(value) ? value : 0;
    if (safe < 0 || safe > Number.MAX_SAFE_INTEGER) {
      const err = new Error('Packed postings offset exceeds safe integer range');
      err.code = 'ERR_PACKED_OFFSETS';
      throw err;
    }
    buffer.writeBigUInt64LE(BigInt(Math.floor(safe)), i * 8);
  }
  return buffer;
};

/**
 * Decode a packed offsets buffer into a number array.
 * @param {Buffer} buffer
 * @returns {number[]}
 */
export const decodePackedOffsets = (buffer) => {
  if (!buffer || buffer.length === 0) return [];
  if (buffer.length % 8 !== 0) throw Object.assign(new Error('Packed offsets contain a partial uint64 value.'), { code: 'ERR_PACKED_OFFSETS' });
  const count = Math.floor(buffer.length / 8);
  const offsets = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const value = buffer.readBigUInt64LE(i * 8);
    if (value > MAX_SAFE_OFFSET) throw Object.assign(new Error('Packed offset exceeds Number.MAX_SAFE_INTEGER.'), { code: 'ERR_PACKED_OFFSETS' });
    offsets[i] = Number(value);
  }
  return offsets;
};

/**
 * Pack token postings lists into a binary blob plus offsets.
 * @param {Array<Array<[number, number]>>} postingsList
 * @param {{blockSize?:number}} [options]
 * @returns {{buffer:Buffer, offsets:number[], blockSize:number}}
 */
export const packTfPostings = (postingsList, { blockSize = DEFAULT_BLOCK_SIZE } = {}) => {
  const list = Array.isArray(postingsList) ? postingsList : [];
  const offsets = new Array(list.length + 1);
  const buffers = [];
  let totalBytes = 0;
  for (const block of iteratePackedTfPostings(list, {
    blockSize,
    onOffset: (index, offset) => { offsets[index] = offset; }
  })) {
    buffers.push(block);
    totalBytes += block.length;
  }
  return { buffer: Buffer.concat(buffers, totalBytes), offsets, blockSize };
};

/**
 * Unpack token postings from a binary blob + offsets array.
 * @param {Buffer} buffer
 * @param {number[]} offsets
 * @param {{blockSize?:number}} [options]
 * @returns {Array<Array<[number, number]>>}
 */
export const unpackTfPostings = (buffer, offsets, { blockSize = DEFAULT_BLOCK_SIZE } = {}) => {
  const resolvedOffsets = Array.isArray(offsets) ? offsets : [];
  if (resolvedOffsets.length <= 1) return [];
  const list = new Array(resolvedOffsets.length - 1);
  for (let i = 0; i < resolvedOffsets.length - 1; i += 1) {
    const start = resolvedOffsets[i] ?? 0;
    const end = resolvedOffsets[i + 1] ?? start;
    if (end <= start) {
      list[i] = [];
      continue;
    }
    const slice = buffer.subarray(start, end);
    list[i] = decodeTfPostingList(slice, blockSize);
  }
  return list;
};

/**
 * Default postings block size used for delta resets.
 */
export const DEFAULT_PACKED_BLOCK_SIZE = DEFAULT_BLOCK_SIZE;

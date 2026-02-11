import { decodeVarint64List, encodeVarint64List } from './varint.js';

const OFFSET_BYTES = 8;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

const toSafeNonNegativeInt = (value, label) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
};

export const encodeU64Offsets = (offsets) => {
  const list = Array.isArray(offsets) ? offsets : [];
  const buffer = Buffer.allocUnsafe(list.length * OFFSET_BYTES);
  for (let i = 0; i < list.length; i += 1) {
    const value = toSafeNonNegativeInt(list[i], 'offset');
    buffer.writeBigUInt64LE(BigInt(value), i * OFFSET_BYTES);
  }
  return buffer;
};

export const decodeU64Offsets = (buffer) => {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const count = Math.floor(bytes.length / OFFSET_BYTES);
  const offsets = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const value = bytes.readBigUInt64LE(i * OFFSET_BYTES);
    if (value > MAX_SAFE_BIGINT) {
      throw new Error(`Offset exceeds Number.MAX_SAFE_INTEGER: ${value.toString()}`);
    }
    offsets[i] = Number(value);
  }
  return offsets;
};

export const encodeBinaryRowFrames = (rowBuffers) => {
  const rows = Array.isArray(rowBuffers) ? rowBuffers : [];
  const offsets = new Array(rows.length);
  const lengths = new Array(rows.length);
  let cursor = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const payload = Buffer.isBuffer(rows[i]) ? rows[i] : Buffer.from(rows[i] || '');
    offsets[i] = cursor;
    lengths[i] = payload.length;
    cursor += payload.length;
  }
  const dataBuffer = Buffer.concat(
    rows.map((entry) => (Buffer.isBuffer(entry) ? entry : Buffer.from(entry || ''))),
    cursor
  );
  return {
    count: rows.length,
    dataBuffer,
    offsets,
    offsetsBuffer: encodeU64Offsets(offsets),
    lengths,
    lengthsBuffer: encodeVarint64List(lengths)
  };
};

export const decodeBinaryRowFrameLengths = (buffer) => {
  const decoded = decodeVarint64List(buffer);
  const lengths = new Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    const value = decoded[i];
    if (value > MAX_SAFE_BIGINT) {
      throw new Error(`Row length exceeds Number.MAX_SAFE_INTEGER: ${value.toString()}`);
    }
    lengths[i] = Number(value);
  }
  return lengths;
};

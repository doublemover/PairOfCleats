import fs from 'node:fs/promises';

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

const toSafeNonNegativeInteger = (value, label = 'varint value') => {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return numeric;
};

const toNonNegativeBigInt = (value, label = 'varint value') => {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new Error(`Invalid ${label}: ${value}`);
    }
    return value;
  }
  return BigInt(toSafeNonNegativeInteger(value, label));
};

const encodeUnsignedVarint = (value, output) => {
  let next = BigInt(toSafeNonNegativeInteger(value));
  while (next >= 0x80n) {
    const byte = Number((next & 0x7fn) | 0x80n);
    output.push(byte);
    next >>= 7n;
  }
  output.push(Number(next));
};

const encodeUnsignedVarint64 = (value, output) => {
  let next = toNonNegativeBigInt(value);
  while (next >= 0x80n) {
    const byte = Number((next & 0x7fn) | 0x80n);
    output.push(byte);
    next >>= 7n;
  }
  output.push(Number(next));
};

export const encodeVarintDeltas = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return Buffer.alloc(0);
  }
  const output = [];
  let prev = 0;
  for (const value of values) {
    const current = toSafeNonNegativeInteger(value, 'delta value');
    const delta = current - prev;
    if (delta < 0) {
      throw new Error(`Delta must be non-negative (prev=${prev}, next=${current}).`);
    }
    encodeUnsignedVarint(delta, output);
    prev = current;
  }
  return Buffer.from(output);
};

export const decodeVarintDeltas = (buffer) => {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const values = [];
  let current = 0n;
  let shift = 0n;
  let delta = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = BigInt(bytes[i]);
    delta |= (byte & 0x7fn) << shift;
    if ((byte & 0x80n) === 0n) {
      current += delta;
      if (current > MAX_SAFE_BIGINT) {
        throw new Error('Varint value exceeds Number.MAX_SAFE_INTEGER.');
      }
      values.push(Number(current));
      delta = 0n;
      shift = 0n;
      continue;
    }
    shift += 7n;
    if (shift > 63n) {
      throw new Error('Varint decode overflow.');
    }
  }
  if (shift !== 0n) {
    throw new Error('Truncated varint sequence.');
  }
  return values;
};

export const readVarintDeltasAt = async (filePath, start, end) => {
  const begin = Number(start);
  const finish = Number(end);
  if (!Number.isSafeInteger(begin) || begin < 0 || !Number.isSafeInteger(finish) || finish < begin) {
    throw new Error(`Invalid varint read range: ${start}-${end}`);
  }
  const length = finish - begin;
  if (length === 0) return [];
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, begin);
    if (bytesRead !== length) {
      throw new Error(`Truncated varint read: expected ${length} bytes, got ${bytesRead}.`);
    }
    return decodeVarintDeltas(buffer.slice(0, bytesRead));
  } finally {
    await handle.close();
  }
};

export const encodeVarint64List = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return Buffer.alloc(0);
  }
  const output = [];
  for (const value of values) {
    encodeUnsignedVarint64(value, output);
  }
  return Buffer.from(output);
};

export const decodeVarint64List = (buffer) => {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const values = [];
  let current = 0n;
  let shift = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = BigInt(bytes[i]);
    current |= (byte & 0x7fn) << shift;
    if ((byte & 0x80n) === 0n) {
      values.push(current);
      current = 0n;
      shift = 0n;
      continue;
    }
    shift += 7n;
    if (shift > 63n) {
      throw new Error('Varint decode overflow.');
    }
  }
  if (shift !== 0n) {
    throw new Error('Truncated varint sequence.');
  }
  return values;
};

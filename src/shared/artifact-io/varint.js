import fs from 'node:fs/promises';

const encodeUnsignedVarint = (value, output) => {
  let next = Number(value);
  if (!Number.isFinite(next) || next < 0) {
    throw new Error(`Invalid varint value: ${value}`);
  }
  while (next >= 0x80) {
    const byte = (next % 0x80) | 0x80;
    output.push(byte);
    next = Math.floor(next / 0x80);
  }
  output.push(next);
};

export const encodeVarintDeltas = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return Buffer.alloc(0);
  }
  const output = [];
  let prev = 0;
  for (const value of values) {
    const current = Number(value);
    if (!Number.isFinite(current) || current < 0) {
      throw new Error(`Invalid delta value: ${value}`);
    }
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
  let current = 0;
  let shift = 0;
  let delta = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    delta += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) {
      current += delta;
      values.push(current);
      delta = 0;
      shift = 0;
      continue;
    }
    shift += 7;
    if (shift > 56) {
      throw new Error('Varint decode overflow.');
    }
  }
  if (shift !== 0) {
    throw new Error('Truncated varint sequence.');
  }
  return values;
};

export const readVarintDeltasAt = async (filePath, start, end) => {
  const begin = Number(start);
  const finish = Number(end);
  if (!Number.isFinite(begin) || !Number.isFinite(finish) || finish < begin) {
    throw new Error(`Invalid varint read range: ${start}-${end}`);
  }
  const length = finish - begin;
  if (length === 0) return [];
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, begin);
    return decodeVarintDeltas(buffer.slice(0, bytesRead));
  } finally {
    await handle.close();
  }
};

import fs from 'node:fs/promises';
import { parseJsonlLine } from './jsonl.js';
import { MAX_JSON_BYTES } from './constants.js';

const OFFSET_BYTES = 8;

const readOffsetValue = (buffer, index) => {
  const value = buffer.readBigUInt64LE(index * OFFSET_BYTES);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Offset exceeds MAX_SAFE_INTEGER: ${value.toString()}`);
  }
  return Number(value);
};

export const readOffsetsFile = async (offsetsPath) => {
  const data = await fs.readFile(offsetsPath);
  const count = Math.floor(data.length / OFFSET_BYTES);
  const offsets = new Array(count);
  for (let i = 0; i < count; i += 1) {
    offsets[i] = readOffsetValue(data, i);
  }
  return offsets;
};

export const readOffsetAt = async (offsetsPath, index) => {
  const handle = await fs.open(offsetsPath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(OFFSET_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, OFFSET_BYTES, index * OFFSET_BYTES);
    if (bytesRead !== OFFSET_BYTES) return null;
    return readOffsetValue(buffer, 0);
  } finally {
    await handle.close();
  }
};

export const resolveOffsetsCount = async (offsetsPath) => {
  const { size } = await fs.stat(offsetsPath);
  return Math.floor(size / OFFSET_BYTES);
};

export const readJsonlRowAt = async (
  jsonlPath,
  offsetsPath,
  index,
  {
    maxBytes = MAX_JSON_BYTES,
    requiredKeys = null
  } = {}
) => {
  if (!Number.isFinite(index) || index < 0) return null;
  const [offsetCount, jsonlStat] = await Promise.all([
    resolveOffsetsCount(offsetsPath),
    fs.stat(jsonlPath)
  ]);
  if (index >= offsetCount) return null;
  const [start, next] = await Promise.all([
    readOffsetAt(offsetsPath, index),
    index + 1 < offsetCount ? readOffsetAt(offsetsPath, index + 1) : null
  ]);
  if (!Number.isFinite(start)) return null;
  const end = Number.isFinite(next) ? next : jsonlStat.size;
  if (end < start) {
    throw new Error(`Invalid offsets: end (${end}) < start (${start}) for ${jsonlPath}`);
  }
  const length = end - start;
  if (length === 0) return null;
  const handle = await fs.open(jsonlPath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    const line = buffer.slice(0, bytesRead).toString('utf8');
    return parseJsonlLine(line, jsonlPath, index + 1, maxBytes, requiredKeys);
  } finally {
    await handle.close();
  }
};

export const validateOffsetsAgainstFile = async (jsonlPath, offsetsPath) => {
  const [offsets, jsonlStat] = await Promise.all([
    readOffsetsFile(offsetsPath),
    fs.stat(jsonlPath)
  ]);
  let last = -1;
  for (const offset of offsets) {
    if (!Number.isFinite(offset) || offset < 0) {
      throw new Error(`Invalid offset value: ${offset}`);
    }
    if (offset < last) {
      throw new Error(`Offsets not monotonic for ${offsetsPath}`);
    }
    last = offset;
  }
  if (offsets.length) {
    if (last > jsonlStat.size) {
      throw new Error(`Offset exceeds file size for ${jsonlPath}`);
    }
  }
  return true;
};

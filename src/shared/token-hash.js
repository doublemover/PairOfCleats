const MASK_64 = (1n << 64n) - 1n;
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const DEFAULT_TOKEN_ID_SEED = 0x9e3779b97f4a7c15n;

const normalizeSeed = (seed) => {
  try {
    return BigInt(seed) & MASK_64;
  } catch {
    return DEFAULT_TOKEN_ID_SEED;
  }
};

export const TOKEN_ID_META = {
  algorithm: 'fnv1a64',
  seed: `0x${DEFAULT_TOKEN_ID_SEED.toString(16)}`,
  encoding: 'hex64'
};

export const TOKEN_ID_CONSTANTS = {
  MASK_64,
  DEFAULT_TOKEN_ID_SEED
};

export const formatHash64 = (value) => {
  const hex = value.toString(16);
  return hex.length >= 16 ? hex.slice(-16) : hex.padStart(16, '0');
};

export const parseHash64 = (value) => {
  if (typeof value === 'bigint') return value & MASK_64;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(value) & MASK_64;
  if (typeof value === 'string') {
    let text = value.trim();
    if (!text) return 0n;
    if (text.endsWith('n') || text.endsWith('N')) {
      text = text.slice(0, -1).trim();
    }
    if (!text) return 0n;
    const prefixed = text.startsWith('0x') || text.startsWith('0X');
    const digits = prefixed ? text.slice(2) : text;
    if (!digits) return 0n;
    if (!/^[0-9a-fA-F]+$/.test(digits)) return 0n;
    try {
      return BigInt(`0x${digits}`) & MASK_64;
    } catch {
      return 0n;
    }
  }
  return 0n;
};

export const hashTokenId64 = (token, seed = DEFAULT_TOKEN_ID_SEED) => {
  if (typeof token !== 'string' || !token) return 0n;
  let hash = FNV_OFFSET_BASIS ^ normalizeSeed(seed);
  for (let i = 0; i < token.length; i += 1) {
    hash ^= BigInt(token.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash & MASK_64;
};

export const hashTokenId64Parts = (parts, seed = DEFAULT_TOKEN_ID_SEED) => {
  if (!Array.isArray(parts) || parts.length === 0) return 0n;
  let hash = FNV_OFFSET_BASIS ^ normalizeSeed(seed);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const value = typeof part === 'string'
      ? part
      : (part == null ? '' : String(part));
    for (let j = 0; j < value.length; j += 1) {
      hash ^= BigInt(value.charCodeAt(j));
      hash = (hash * FNV_PRIME) & MASK_64;
    }
    hash ^= 0n;
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash & MASK_64;
};

export const hashTokenId64Window = (
  parts,
  start = 0,
  length = null,
  seed = DEFAULT_TOKEN_ID_SEED
) => {
  if (!Array.isArray(parts) || !parts.length) return 0n;
  const begin = Number.isFinite(Number(start)) ? Math.max(0, Math.floor(Number(start))) : 0;
  if (begin >= parts.length) return 0n;
  const size = Number.isFinite(Number(length))
    ? Math.max(0, Math.floor(Number(length)))
    : (parts.length - begin);
  if (!size) return 0n;
  const end = Math.min(parts.length, begin + size);
  let hash = FNV_OFFSET_BASIS ^ normalizeSeed(seed);
  for (let i = begin; i < end; i += 1) {
    hash ^= parseHash64(parts[i]);
    hash = (hash * FNV_PRIME) & MASK_64;
    hash ^= 0n;
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash & MASK_64;
};

export const hashTokenId = (token, { seed = DEFAULT_TOKEN_ID_SEED } = {}) => (
  formatHash64(hashTokenId64(token, seed))
);

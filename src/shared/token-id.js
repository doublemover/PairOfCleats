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

export const formatHash64 = (value) => {
  const hex = value.toString(16);
  return hex.length >= 16 ? hex.slice(-16) : hex.padStart(16, '0');
};

export const parseHash64 = (value) => {
  if (typeof value === 'bigint') return value & MASK_64;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(value) & MASK_64;
  if (typeof value === 'string') {
    const trimmed = value.startsWith('0x') ? value.slice(2) : value;
    if (!trimmed) return 0n;
    return BigInt(`0x${trimmed}`) & MASK_64;
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

export const hashTokenId = (token, { seed = DEFAULT_TOKEN_ID_SEED } = {}) => (
  formatHash64(hashTokenId64(token, seed))
);

export const TOKEN_ID_CONSTANTS = {
  MASK_64,
  DEFAULT_TOKEN_ID_SEED
};

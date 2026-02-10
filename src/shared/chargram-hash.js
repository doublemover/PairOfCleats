import { formatHash64, parseHash64, TOKEN_ID_CONSTANTS } from './token-id.js';

const { MASK_64 } = TOKEN_ID_CONSTANTS;
const DEFAULT_CHARGRAM_BASE = 911382323n;
const DEFAULT_CHARGRAM_SEED = 0x3c79ac492ba7b653n;
const SENTINEL_START = '\u0002';
const SENTINEL_END = '\u0003';
const HASH_PREFIX = 'h64:';

const normalizeBigInt = (value, fallback) => {
  try {
    return BigInt(value) & MASK_64;
  } catch {
    return fallback;
  }
};

export const CHARGRAM_HASH_META = {
  algorithm: 'rk64',
  base: `0x${DEFAULT_CHARGRAM_BASE.toString(16)}`,
  seed: `0x${DEFAULT_CHARGRAM_SEED.toString(16)}`,
  encoding: 'hex64',
  prefix: HASH_PREFIX,
  sentinelStart: SENTINEL_START,
  sentinelEnd: SENTINEL_END
};

export const formatChargramHash = (value) => `${HASH_PREFIX}${formatHash64(value)}`;

export const parseChargramHash = (value) => {
  if (typeof value === 'string' && value.startsWith(HASH_PREFIX)) {
    return parseHash64(value.slice(HASH_PREFIX.length));
  }
  return parseHash64(value);
};

const buildPowTable = (base, maxN) => {
  const pow = new Array(maxN + 1);
  pow[0] = 1n;
  for (let i = 1; i <= maxN; i += 1) {
    pow[i] = (pow[i - 1] * base) & MASK_64;
  }
  return pow;
};

export const forEachRollingChargramHash = (
  token,
  minN,
  maxN,
  {
    maxTokenLength = null,
    base = DEFAULT_CHARGRAM_BASE,
    seed = DEFAULT_CHARGRAM_SEED,
    sentinelStart = SENTINEL_START,
    sentinelEnd = SENTINEL_END
  } = {},
  callback
) => {
  if (typeof token !== 'string' || !token) return;
  if (maxTokenLength && token.length > maxTokenLength) return;
  const resolvedMinN = Math.max(1, Math.floor(Number(minN)));
  const resolvedMaxN = Math.max(resolvedMinN, Math.floor(Number(maxN)));
  if (!Number.isFinite(resolvedMinN) || !Number.isFinite(resolvedMaxN)) return;

  const baseValue = normalizeBigInt(base, DEFAULT_CHARGRAM_BASE);
  const seedValue = normalizeBigInt(seed, DEFAULT_CHARGRAM_SEED);
  const source = `${sentinelStart}${token}${sentinelEnd}`;
  const length = source.length;
  if (length < resolvedMinN) return;

  const codes = new Array(length);
  for (let i = 0; i < length; i += 1) {
    codes[i] = BigInt(source.charCodeAt(i));
  }

  const powTable = buildPowTable(baseValue, resolvedMaxN);
  let halted = false;
  const emit = (value) => {
    if (halted) return;
    if (callback && callback(value) === false) {
      halted = true;
    }
  };

  for (let n = resolvedMinN; n <= resolvedMaxN; n += 1) {
    if (halted) return;
    if (n > length) break;
    let hash = 0n;
    for (let i = 0; i < n; i += 1) {
      hash = (hash * baseValue + codes[i]) & MASK_64;
    }
    emit(formatChargramHash(hash ^ seedValue));
    for (let i = n; i < length; i += 1) {
      const outgoing = codes[i - n];
      const outgoingTerm = (outgoing * powTable[n - 1]) & MASK_64;
      hash = (hash + MASK_64 - outgoingTerm) & MASK_64;
      hash = (hash * baseValue + codes[i]) & MASK_64;
      emit(formatChargramHash(hash ^ seedValue));
      if (halted) return;
    }
  }
};

export const buildChargramHashSet = (
  tokens,
  { minN, maxN, maxTokenLength } = {},
  buffers = null
) => {
  const set = buffers?.chargramSet || new Set();
  if (buffers?.chargramSet) set.clear();
  if (!Array.isArray(tokens) || !tokens.length) return set;
  for (const token of tokens) {
    forEachRollingChargramHash(token, minN, maxN, { maxTokenLength }, (hash) => {
      set.add(hash);
    });
  }
  return set;
};

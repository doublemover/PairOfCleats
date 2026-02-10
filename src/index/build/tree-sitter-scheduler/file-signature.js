const toFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const createTreeSitterFileVersionSignature = ({ size, mtimeMs, hash }) => ({
  size: toFiniteNumber(size),
  mtimeMs: toFiniteNumber(mtimeMs),
  hash: toNonEmptyString(hash)
});

export const normalizeTreeSitterFileVersionSignature = (value) => {
  if (!value || typeof value !== 'object') return null;
  return createTreeSitterFileVersionSignature({
    size: value.size,
    mtimeMs: value.mtimeMs,
    hash: value.hash
  });
};

export const treeSitterFileVersionSignaturesEqual = (a, b) => {
  if (!a || !b) return false;
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.hash === b.hash;
};

export const formatTreeSitterFileVersionSignature = (signature) => {
  if (!signature || typeof signature !== 'object') return 'unknown';
  const size = Number.isFinite(signature.size) ? signature.size : 'null';
  const mtimeMs = Number.isFinite(signature.mtimeMs) ? signature.mtimeMs : 'null';
  const hash = typeof signature.hash === 'string' && signature.hash ? signature.hash : 'null';
  return `size=${size},mtimeMs=${mtimeMs},hash=${hash}`;
};
